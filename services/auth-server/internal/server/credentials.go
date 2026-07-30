package server

import (
	"context"
	"errors"
	"fmt"
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
func (s *Server) CreateCredential(_ context.Context, userID, email, password string) error {
	if _, err := parseUserID(userID); err != nil {
		return err
	}
	if err := ValidatePasswordPolicy(password); err != nil {
		return err
	}
	// T051 implementa la normalización del correo y el `store.CreateCredential`
	// con el hash de `s.hasher`. La contraseña en claro no se registra en ningún
	// log ni se guarda en ninguna variable que sobreviva a esta función.
	_ = email
	return ErrNotImplemented
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
		// T051: tratarlo como refresh token (`DeleteRefreshToken`). Un token que no
		// parsea y tampoco existe como refresh se considera ya revocado y NO es un
		// error — RFC 7009 lo exige, para que un logout no falle nunca por
		// presentar un token que ya había caducado.
		_ = tokenTypeHint
		return ErrNotImplemented
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
