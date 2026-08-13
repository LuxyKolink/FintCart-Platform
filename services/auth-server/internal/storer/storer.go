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
	// ErrVerificationTokenInvalid cubre INDISTINGUIBLEMENTE el token equivocado,
	// el ya usado, el caducado y el `user_id` inexistente. Separarlos convertiría
	// `/auth/verify-email` en un oráculo: probando identificadores al azar se
	// sabría cuáles corresponden a cuentas reales pendientes de verificar.
	ErrVerificationTokenInvalid = errors.New("storer: token de verificación inválido o caducado")
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
	// SetVerificationToken guarda el hash del token de verificación y su
	// caducidad, sustituyendo al anterior si lo había. Devuelve [ErrConflict] si
	// la cuenta no está en `pending_verification`: no hay nada que verificar en
	// una cuenta ya activa, y una anonimizada no debe poder revivir.
	SetVerificationToken(ctx context.Context, userID uuid.UUID, tokenHash string, expiresAt time.Time) error
	// ActivateCredential mueve `pending_verification` → `active` comprobando el
	// token en la MISMA sentencia.
	//
	// Que la comprobación viaje aquí y no se haga antes con un `Get` no es un
	// detalle de estilo: separarlas dejaría una ventana en la que dos peticiones
	// concurrentes con el mismo token —el usuario que hace doble clic en el
	// enlace— pasarían las dos la validación. Con un solo UPDATE, la segunda no
	// encuentra fila porque la primera ya borró el token.
	ActivateCredential(ctx context.Context, userID uuid.UUID, tokenHash string) error
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

	// RegisterFailedLogin cuenta un intento fallido y bloquea la cuenta si alcanza
	// el umbral, todo en una transacción (Edge Cases: intentos repetidos de
	// inicio de sesión fallidos). Devuelve `locked = true` EXACTAMENTE la vez que
	// el bloqueo se activa —no en los intentos siguientes contra una cuenta ya
	// bloqueada—, que es la señal que necesita `server` para publicar
	// `auth.security_alert` una sola vez por episodio y no en cada intento
	// posterior.
	RegisterFailedLogin(ctx context.Context, userID uuid.UUID, threshold int32, lockDuration time.Duration) (locked bool, err error)
	// ResetFailedLogins limpia el contador y el bloqueo tras un login válido.
	ResetFailedLogins(ctx context.Context, userID uuid.UUID) error

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
	// LookupRefreshToken devuelve el usuario dueño del token.
	//
	// Tres resultados posibles, y los tres importan:
	//   - `(userID, nil)`             el token está vivo.
	//   - `(uuid.Nil, ErrNotFound)`   no existe o caducó.
	//   - `(userID, ErrTokenReuse)`   YA se rotó: se devuelve el usuario JUNTO con el
	//     error, porque es justo lo que hace falta para cortar la familia entera con
	//     [TokenStore.InvalidateFamily]. Devolver solo el error dejaría la detección
	//     de reutilización sin forma de actuar.
	LookupRefreshToken(ctx context.Context, tokenID string) (uuid.UUID, error)
	// InvalidateFamily borra todos los refresh tokens vivos de un usuario.
	//
	// Es la reacción a una reutilización detectada: el legítimo y el ladrón son
	// indistinguibles a partir de ese punto, así que la única respuesta segura es
	// obligar a los dos a autenticarse de nuevo.
	InvalidateFamily(ctx context.Context, userID uuid.UUID) error
}

// Comprobaciones en tiempo de compilación de los dos implementadores.
var (
	_ Storer     = (*PostgresStorer)(nil)
	_ TokenStore = (*RedisStore)(nil)
)
