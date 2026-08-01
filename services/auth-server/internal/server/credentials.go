package server

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/fintcart/platform/services/auth-server/internal/storer"
)

// Ciclo de vida de la credencial: creación, activación, validación, revocación e
// introspección.

// CredentialCheck es el resultado de validar correo y contraseña.
//
// Devuelve `LoginStatus` además de `Valid` porque quien llama necesita distinguir
// «contraseña correcta pero cuenta sin verificar» (FR-002: acceso limitado) de
// «cuenta anonimizada» (FR-030: acceso imposible). Lo que NO debe hacer es
// revelar esa distinción al usuario final sin autenticar — de eso se encarga el
// Gateway con el mensaje que muestra.
type CredentialCheck struct {
	Valid         bool
	UserID        string
	EmailVerified bool
	LoginStatus   string
}

// Introspection es el resultado de introspeccionar un access token.
type Introspection struct {
	Active    bool
	UserID    string
	Roles     []string
	JTI       string
	ExpiresAt time.Time
}

// ── producción de eventos (Principio V) ─────────────────────────────────────

// Event es un evento de dominio de este servicio, ANTES de envolverse.
//
// No lleva `event_id` ni `occurred_at`: los pone el publicador al construir el
// envelope del catálogo. Ponerlos aquí obligaría a cada sitio que produce un evento
// a acordarse del formato de la fecha, y el primero que se despistara metería un
// evento con un `occurred_at` en hora local que Auditoría ordenaría mal.
//
// `ActorRef` es el identificador OPACO del titular, nunca su correo: el catálogo lo
// exige para que la traza siga sirviendo después de una anonimización (FR-030/031).
// Por la misma razón `Payload` no debe llevar datos personales. Si algún día
// transporta un monto, viaja como cadena decimal canónica (Principio VIII / D-10).
type Event struct {
	Type     string
	ActorRef string
	Payload  map[string]any
}

// EventAuthSessionRevoked es la routing key del evento de revocación (FR-004).
const EventAuthSessionRevoked = "auth.session_revoked"

// Claves del payload de `auth.session_revoked`.
const (
	payloadKeyTokenType = "token_type"
	payloadKeyJTI       = "jti"

	tokenKindAccess  = "access_token"
	tokenKindRefresh = "refresh_token"
)

// EventPublisher entrega eventos de dominio al bus. Lo implementa
// `internal/events` (Principio IX: el puerto se declara donde se consume).
//
// `Publish` NO devuelve error, y eso es una decisión de diseño, no un descuido.
// Quien la llama ya ejecutó un efecto irreversible —una sesión revocada no se
// «des-revoca»—, así que un fallo del bus no puede convertirse en el error de la
// operación: el cliente vería «el logout falló» sobre una sesión que SÍ está
// cerrada, y volvería a intentarlo creyéndose dentro. Con esta firma el error es
// imposible de propagar por descuido; el implementador es responsable de dejar
// constancia de lo que no pudo entregar.
//
// LIMITACIÓN CONOCIDA: este servicio no tiene outbox transaccional —D-07 lo sitúa
// en el Orquestador—, así que un evento que no llega al broker solo queda en el log
// de error. La solución durable es una tabla de outbox en `auth_db`; está anotada,
// no implementada.
type EventPublisher interface {
	Publish(ctx context.Context, event Event)
}

// CreateCredential crea la credencial en `pending_verification`. Paso de la saga
// de registro, idempotente por `user_id` (D-04).
//
// La contraseña en claro no se registra en ningún log y no sobrevive a esta función:
// entra como parámetro, va al hasher y desaparece. No hay ninguna variable
// intermedia que la copie ni ningún error que la interpole.
func (s *Server) CreateCredential(ctx context.Context, userID, email, password string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	// La política se comprueba ANTES de derivar el hash. Derivar un Argon2id de una
	// contraseña que se va a rechazar de todos modos son 64 MiB y varios milisegundos
	// tirados, y un vector de agotamiento trivial de explotar.
	if err := ValidatePasswordPolicy(password); err != nil {
		return err
	}

	normalized := normalizeEmail(email)
	if normalized == "" {
		return fmt.Errorf("%w: correo vacío", ErrInvalidArgument)
	}

	hash, err := s.hasher.Hash(password)
	if err != nil {
		return fmt.Errorf("derivar el hash de la contraseña: %w", err)
	}

	row := storer.CredentialRow{
		ID:           id,
		Email:        normalized,
		PasswordHash: hash,
		// Nace SIN verificar (FR-002): el acceso pleno lo desbloquea la saga de
		// verificación de correo, no el registro.
		LoginStatus: storer.StatusPendingVerification,
	}
	if err := s.store.CreateCredential(ctx, row); err != nil {
		return fmt.Errorf("crear credencial: %w", err)
	}
	return nil
}

// ChangePasswordHash sustituye la contraseña de una cuenta existente.
//
// Valida la política igual que el registro: si solo se validara al crear la cuenta,
// un cambio de contraseña sería la vía para saltarse la longitud mínima.
func (s *Server) ChangePasswordHash(ctx context.Context, userID, newPassword string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	if err := ValidatePasswordPolicy(newPassword); err != nil {
		return err
	}

	hash, err := s.hasher.Hash(newPassword)
	if err != nil {
		return fmt.Errorf("derivar el hash de la contraseña: %w", err)
	}
	if err := s.store.UpdatePasswordHash(ctx, id, hash); err != nil {
		return fmt.Errorf("actualizar hash de contraseña: %w", err)
	}
	return nil
}

// normalizeEmail recorta espacios y pasa a minúsculas.
//
// La columna es `CITEXT`, así que la base ya compara sin distinguir mayúsculas; esto
// normaliza lo que se GUARDA para que el valor devuelto en un perfil sea estable y
// no dependa de cómo lo escribió el usuario el día del registro. Los espacios sí hay
// que recortarlos aquí: `CITEXT` no los ignora, y « ana@x.co» y «ana@x.co» serían dos
// cuentas distintas.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// ActivateCredential cierra la saga de verificación de correo (FR-002).
func (s *Server) ActivateCredential(ctx context.Context, userID string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	if err := s.store.ActivateCredential(ctx, id); err != nil {
		return fmt.Errorf("activar credencial: %w", err)
	}
	return nil
}

// ValidateCredentials comprueba correo y contraseña durante el login.
//
// Devuelve `Valid: false` sin error cuando las credenciales no cuadran, y reserva
// el error para los fallos reales (base de datos caída, hash corrupto). La
// distinción importa: un error hace que el Gateway responda 500 y el usuario
// reintente; un `Valid: false` es una respuesta legítima del flujo.
//
// El correo inexistente y la contraseña incorrecta producen el MISMO resultado, a
// propósito (ver [ErrUnauthenticated]).
func (s *Server) ValidateCredentials(ctx context.Context, email, password string) (CredentialCheck, error) {
	cred, err := s.store.GetCredentialByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, storer.ErrNotFound) {
			// Correo no registrado: mismo resultado que contraseña incorrecta.
			return CredentialCheck{Valid: false}, nil
		}
		return CredentialCheck{}, fmt.Errorf("leer credencial por correo: %w", err)
	}

	ok, err := s.hasher.Verify(cred.PasswordHash, password)
	if err != nil {
		return CredentialCheck{}, fmt.Errorf("verificar contraseña: %w", err)
	}
	if !ok {
		return CredentialCheck{Valid: false}, nil
	}

	// Solo `active` autentica (FR-002). La comprobación es una LISTA BLANCA y no un
	// rechazo de los estados que hoy sabemos malos, y la diferencia no es estilística:
	// el día que el esquema admita un estado nuevo —`suspended`, `locked`—, una lista
	// negra lo dejaría entrar por omisión, y nadie se enteraría hasta que una cuenta
	// suspendida operara con normalidad. Con lista blanca, un estado desconocido no
	// autentica y el fallo es del lado seguro.
	//
	// Los dos estados que hoy quedan fuera lo hacen por razones distintas:
	// `pending_verification` bloquea el acceso pleno hasta verificar el correo
	// (FR-002), y `anonymized` lo hace de forma permanente (FR-030) — ahí el hash se
	// sustituyó por un valor que ninguna contraseña puede satisfacer, así que esta
	// comprobación es la segunda barrera, no la única.
	if cred.LoginStatus != storer.StatusActive {
		// Se devuelve el ESTADO pero no el `user_id`: quien llama necesita el estado
		// para decirle al usuario que revise su correo, y no necesita un identificador
		// con el que podría intentar emitir algo. Un `Valid: false` no debe llevar
		// nunca encima lo que haría falta para seguir adelante.
		//
		// Filtrar el estado aquí NO es un oráculo: para llegar a esta línea hay que
		// haber acertado la contraseña. Un correo desconocido o una contraseña
		// incorrecta salen antes, con el estado vacío.
		return CredentialCheck{Valid: false, LoginStatus: cred.LoginStatus}, nil
	}

	return credentialCheckFromRow(cred), nil
}

// assertIssuable rechaza la EMISIÓN de tokens para una cuenta que no está activa
// (FR-002, FR-030).
//
// Existe como función y no como tres comprobaciones repetidas porque los puntos de
// emisión son tres —emitir el código, canjearlo y renovar— y cada uno abre una
// ventana propia: entre autenticarse y canjear caben 45 segundos, y una renovación
// puede llegar treinta días después de la última contraseña escrita. Un servicio
// que solo comprobara el estado al autenticar dejaría vivas las sesiones de una
// cuenta anonimizada hasta que su refresh token caducara.
func (s *Server) assertIssuable(ctx context.Context, userID uuid.UUID) error {
	cred, err := s.store.GetCredential(ctx, userID)
	if err != nil {
		if errors.Is(err, storer.ErrNotFound) {
			// «No hay credencial» es un fallo de AUTENTICACIÓN, no un recurso ausente:
			// como `NotFound` viajaría al cliente como la confirmación de que ese
			// identificador no existe, y como `Unauthenticated` no dice nada.
			return fmt.Errorf("%w: no hay credencial para %s: %w", ErrUnauthenticated, userID, err)
		}
		return fmt.Errorf("leer credencial %s: %w", userID, err)
	}
	if cred.LoginStatus != storer.StatusActive {
		// El estado concreto va al LOG —`grpcError` sanea el mensaje que sale— porque
		// es la diferencia entre «no verificó el correo» y «la cuenta se anonimizó», y
		// esa distinción hace falta para diagnosticar, no para responder.
		return fmt.Errorf("%w: la cuenta %s está en estado %q", ErrUnauthenticated, userID, cred.LoginStatus)
	}
	return nil
}

// Revoke revoca un token con efecto inmediato (FR-004, logout).
//
// «Inmediato» es literal y es la razón de que exista la blacklist: un JWT es
// autovalidable, así que sin una lista de revocados seguiría siendo aceptado hasta
// su expiración por cualquiera que lo presente. El TTL de la entrada es la vida
// RESIDUAL del token: guardarlo más tiempo no aporta nada, porque a partir de la
// expiración el token se rechaza por sí solo.
func (s *Server) Revoke(ctx context.Context, token, tokenTypeHint string) error {
	if token == "" {
		return fmt.Errorf("%w: token vacío", ErrInvalidArgument)
	}

	// El `token_type_hint` es una pista del cliente, no una verdad: se intenta
	// primero como access token y, si no parsea, se trata como refresh.
	claims, err := s.maker.Parse(token)
	if err != nil {
		// No es un JWT válido: se trata como refresh token. El `token_type_hint` se
		// ignora deliberadamente —es una pista del cliente, no una verdad— y probar
		// los dos tipos cuesta lo mismo que fiarse de él.
		_ = tokenTypeHint
		tokenID := refreshTokenID(token)

		// La consulta va ANTES del borrado y sirve solo para saber a quién auditar: el
		// refresh token no es un JWT y no lleva dentro a su dueño, así que después de
		// borrarlo ya no habría forma de averiguarlo. Su error no interrumpe nada — el
		// logout no puede depender de que la auditoría sepa a quién apuntar.
		owner, lookupErr := s.tokens.LookupRefreshToken(ctx, tokenID)

		// `DeleteRefreshToken` es idempotente, así que un token que tampoco existe
		// como refresh se considera ya revocado y NO produce error. Lo exige el
		// RFC 7009 §2.2: un logout no puede fallar por presentar algo que ya no vale,
		// porque el efecto buscado —que no sirva— ya se cumplió.
		if err := s.tokens.DeleteRefreshToken(ctx, tokenID); err != nil {
			return fmt.Errorf("revocar refresh token: %w", err)
		}

		// Se audita lo que se REVOCÓ, no lo que se intentó revocar. Un token
		// inexistente, caducado o ya rotado no cerró ninguna sesión, y anotarlo
		// llenaría el registro de revocaciones que nunca ocurrieron —justo el ruido
		// que hace inservible una traza de auditoría—.
		if lookupErr == nil {
			s.publishSessionRevoked(ctx, owner.String(), tokenKindRefresh, "")
		}
		return nil
	}

	ttl := time.Until(claims.ExpiresAt)
	if ttl <= 0 {
		// Ya expirado: no hay nada que revocar y no es un error.
		return nil
	}
	if err := s.tokens.BlacklistJTI(ctx, claims.JTI, ttl); err != nil {
		return fmt.Errorf("revocar access token: %w", err)
	}
	s.publishSessionRevoked(ctx, claims.UserID, tokenKindAccess, claims.JTI)
	return nil
}

// publishSessionRevoked anota la revocación para Auditoría (FR-004, catálogo).
//
// Se llama DESPUÉS de revocar y nunca antes: un evento publicado sobre una
// revocación que después falla dejaría en el registro inmutable de Auditoría una
// sesión cerrada que sigue abierta, y un registro inmutable no admite rectificación.
//
// El payload no lleva datos personales: el titular viaja como `actor_ref` opaco, y
// el `jti` identifica al token, no a la persona. Auditoría necesita distinguir el
// cierre de UNA sesión (access token) del de la renovación (refresh) para poder
// reconstruir después qué pasó con una cuenta.
func (s *Server) publishSessionRevoked(ctx context.Context, actorRef, tokenKind, jti string) {
	payload := map[string]any{payloadKeyTokenType: tokenKind}
	if jti != "" {
		payload[payloadKeyJTI] = jti
	}
	s.events.Publish(ctx, Event{
		Type:     EventAuthSessionRevoked,
		ActorRef: actorRef,
		Payload:  payload,
	})
}

// Introspect valida un access token para el API Gateway.
//
// Devuelve `Active: false` para un token inválido, expirado o revocado, y reserva
// el error para los fallos de infraestructura. Un fallo al CONSULTAR la blacklist
// se propaga como error y no como `Active: true`: si no se puede saber si un token
// fue revocado, la respuesta correcta no es «adelante».
func (s *Server) Introspect(ctx context.Context, accessToken string) (Introspection, error) {
	claims, err := s.maker.Parse(accessToken)
	if err != nil {
		// Firma inválida, formato roto o expirado: no es un error del servicio.
		return Introspection{Active: false}, nil
	}

	blacklisted, err := s.tokens.IsBlacklisted(ctx, claims.JTI)
	if err != nil {
		return Introspection{}, fmt.Errorf("consultar blacklist de %s: %w", claims.JTI, err)
	}
	if blacklisted {
		return Introspection{Active: false}, nil
	}

	// Los roles se resuelven en la introspección y no se leen del token: un rol
	// revocado hace un minuto tiene que dejar de aplicar ya, y un JWT emitido antes
	// seguiría afirmando lo contrario durante toda su vida.
	roles, err := s.authctx.Roles(ctx, claims.UserID)
	if err != nil {
		return Introspection{}, fmt.Errorf("resolver roles de %s: %w", claims.UserID, err)
	}

	return Introspection{
		Active:    true,
		UserID:    claims.UserID,
		Roles:     roles,
		JTI:       claims.JTI,
		ExpiresAt: claims.ExpiresAt,
	}, nil
}
