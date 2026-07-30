// Capa de persistencia del Servidor de Autenticación (Principio IX).
//
// Este servicio persiste en DOS sitios y la división no es negociable
// (Principio IV): PostgreSQL guarda credenciales, clientes OAuth y códigos de
// autorización; Redis guarda ÚNICAMENTE la blacklist de JWT y los refresh tokens.
// Redis no es una caché de credenciales ni un almacén alternativo — es el único
// lugar donde tiene sentido un dato con TTL, y esos dos lo tienen por definición.
//
// De ahí que haya dos interfaces: [Storer] y [TokenStore]. Separarlas hace visible
// en el tipo qué operaciones tocan qué motor, y hace imposible que un método
// «se cambie de sitio» sin que la firma lo delate.
package storer

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Centinelas de la capa de persistencia. `server` los traduce a errores de
// dominio; `handler` traduce esos a códigos gRPC. Ninguna capa salta un paso.
var (
	ErrNotFound = errors.New("storer: no encontrado")
	ErrConflict = errors.New("storer: conflicto con el estado actual")
	// ErrNotImplemented marca los métodos del esqueleto (T025). Es explícito para
	// que la ausencia de implementación falle de forma ruidosa: en un servicio de
	// autenticación, un stub que devolviera «válido» por omisión sería un agujero
	// de seguridad, no un TODO.
	ErrNotImplemented = errors.New("storer: no implementado")
)

// wrap añade la operación conservando la causa (Principio XI regla 6).
func wrap(op string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("storer: %s: %w", op, err)
}

// Storer es el contrato de persistencia en PostgreSQL.
type Storer interface {
	// ── credentials ──────────────────────────────────────────────────────────

	// CreateCredential inserta la credencial en `pending_verification`. Paso de la
	// saga de registro, y por tanto idempotente por `id` (D-04).
	CreateCredential(ctx context.Context, c CredentialRow) error
	// ActivateCredential mueve `pending_verification` → `active`.
	ActivateCredential(ctx context.Context, userID uuid.UUID) error
	// GetCredentialByEmail es la lectura del login. Devuelve [ErrNotFound] si el
	// correo no existe; quien llame DEBE tratar «no existe» y «contraseña
	// incorrecta» de forma indistinguible hacia el cliente, para no convertir el
	// login en un oráculo de qué correos están registrados.
	GetCredentialByEmail(ctx context.Context, email string) (CredentialRow, error)
	GetCredential(ctx context.Context, userID uuid.UUID) (CredentialRow, error)
	UpdatePasswordHash(ctx context.Context, userID uuid.UUID, hash string) error
	// AnonymizeCredential sustituye correo y hash por valores opacos y pone
	// `anonymized` (FR-030). No borra la fila: `authorization_codes` la referencia
	// y el hecho de que la cuenta existió es información de auditoría.
	AnonymizeCredential(ctx context.Context, userID uuid.UUID, opaqueEmail string) error

	// ── oauth_clients ────────────────────────────────────────────────────────

	GetOAuthClient(ctx context.Context, clientID string) (OAuthClientRow, error)

	// ── authorization_codes ──────────────────────────────────────────────────

	InsertAuthCode(ctx context.Context, c AuthCodeRow) error
	// ConsumeAuthCode marca el código como usado y lo devuelve, todo en una sola
	// operación atómica. La firma combina lectura y escritura a propósito: un
	// `Get` seguido de un `MarkConsumed` deja una ventana en la que dos
	// intercambios concurrentes del mismo código obtienen tokens los dos.
	// Devuelve [ErrConflict] si ya estaba consumido o expiró.
	ConsumeAuthCode(ctx context.Context, code string) (AuthCodeRow, error)
	// DeleteExpiredAuthCodes es el barrido de mantenimiento.
	DeleteExpiredAuthCodes(ctx context.Context, olderThan time.Time) (int64, error)
}

// TokenStore es el contrato de Redis: blacklist de JWT y refresh tokens
// (Principio IV, uno de los dos únicos usos permitidos de Redis en la plataforma).
type TokenStore interface {
	// BlacklistJTI marca un access token como revocado hasta que expire. El TTL
	// es la vida RESIDUAL del token y no un valor fijo: más corto reviviría un
	// token revocado, y más largo llenaría Redis con entradas de tokens que ya no
	// pueden validarse de todos modos (FR-004).
	BlacklistJTI(ctx context.Context, jti string, ttl time.Duration) error
	IsBlacklisted(ctx context.Context, jti string) (bool, error)

	// SaveRefreshToken guarda el refresh token con su TTL.
	SaveRefreshToken(ctx context.Context, tokenID string, userID uuid.UUID, ttl time.Duration) error
	// RotateRefreshToken invalida el token presentado y guarda el nuevo de forma
	// atómica (rotación obligatoria, D-05). La atomicidad es el punto: si el
	// antiguo se borrara y el nuevo no llegara a guardarse, el usuario quedaría
	// sin sesión sin haber hecho nada mal.
	RotateRefreshToken(ctx context.Context, oldTokenID, newTokenID string, userID uuid.UUID, ttl time.Duration) error
	// DeleteRefreshToken revoca el refresh token (logout, FR-004).
	DeleteRefreshToken(ctx context.Context, tokenID string) error
	// LookupRefreshToken devuelve el usuario dueño del token, o [ErrNotFound].
	LookupRefreshToken(ctx context.Context, tokenID string) (uuid.UUID, error)
}

// Comprobaciones en tiempo de compilación de los dos implementadores.
var (
	_ Storer     = (*PostgresStorer)(nil)
	_ TokenStore = (*RedisStore)(nil)
)
