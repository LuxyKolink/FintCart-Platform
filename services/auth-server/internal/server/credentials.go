package server

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

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

	// Una cuenta anonimizada nunca es válida, aunque el hash coincida: FR-030 la
	// deja inutilizable de forma permanente, y el hash se sustituye por un valor
	// que no puede corresponder a ninguna contraseña. La comprobación explícita es
	// la segunda barrera, no la única.
	if cred.LoginStatus == storer.StatusAnonymized {
		return CredentialCheck{Valid: false, LoginStatus: cred.LoginStatus}, nil
	}

	return credentialCheckFromRow(cred), nil
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
		//
		// `DeleteRefreshToken` es idempotente, así que un token que tampoco existe
		// como refresh se considera ya revocado y NO produce error. Lo exige el
		// RFC 7009 §2.2: un logout no puede fallar por presentar algo que ya no vale,
		// porque el efecto buscado —que no sirva— ya se cumplió.
		_ = tokenTypeHint
		if err := s.tokens.DeleteRefreshToken(ctx, refreshTokenID(token)); err != nil {
			return fmt.Errorf("revocar refresh token: %w", err)
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
	return nil
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
