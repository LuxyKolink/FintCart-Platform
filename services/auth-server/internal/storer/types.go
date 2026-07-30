// Tipos de FILA del Servidor de Autenticación: un registro de `auth_db` tal como
// vive en la base, y nada más (Principio IX regla 3, «DTO ≠ dominio ≠ fila»).
//
// Siguen columna por columna la migración `*_init_auth.up.sql`. Un detalle que no
// es casual: en ningún struct de este archivo existe un campo de contraseña en
// claro. Solo `PasswordHash`. La constitución exige que la contraseña nunca se
// persista ni se registre en claro, y la forma de garantizarlo es que no haya
// ningún tipo capaz de transportarla a esta capa.
package storer

import (
	"time"

	"github.com/google/uuid"
)

// CredentialRow ≡ tabla `credentials`.
type CredentialRow struct {
	ID           uuid.UUID `db:"id"`
	Email        string    `db:"email"`
	PasswordHash string    `db:"password_hash"`
	LoginStatus  string    `db:"login_status"`
	CreatedAt    time.Time `db:"created_at"`
	UpdatedAt    time.Time `db:"updated_at"`
}

// Estados de `credentials.login_status`, replicados del CHECK del esquema.
//
// Se declaran como constantes y no como cadenas sueltas porque el CHECK de
// PostgreSQL solo protege la escritura: una comparación con `"aktive"` mal escrita
// compilaría, no escribiría nada y devolvería «credenciales inválidas» para una
// cuenta perfectamente válida.
const (
	// StatusPendingVerification bloquea el acceso pleno hasta verificar el correo
	// (FR-002).
	StatusPendingVerification = "pending_verification"
	// StatusActive es el único estado que permite emitir tokens.
	StatusActive = "active"
	// StatusAnonymized impide la emisión de tokens de forma permanente (FR-030).
	StatusAnonymized = "anonymized"
)

// OAuthClientRow ≡ tabla `oauth_clients`.
//
// `ClientSecretHash` es un puntero porque la columna es nullable y esa nulabilidad
// ES la distinción entre un cliente público (la SPA, que usa PKCE y no tiene
// secreto) y uno confidencial (M2M). Colapsarla a `""` haría que un secreto vacío
// y la ausencia de secreto fueran indistinguibles, que es justo la confusión que
// el CHECK `oauth_clients_secret_matches_visibility` existe para impedir.
type OAuthClientRow struct {
	ID               uuid.UUID `db:"id"`
	ClientID         string    `db:"client_id"`
	ClientSecretHash *string   `db:"client_secret_hash"`
	GrantTypes       []string  `db:"grant_types"`
	RedirectURIs     []string  `db:"redirect_uris"`
	Scopes           []string  `db:"scopes"`
	IsPublic         bool      `db:"is_public"`
	CreatedAt        time.Time `db:"created_at"`
}

// AuthCodeRow ≡ tabla `authorization_codes`.
//
// El código es de un solo uso y con TTL ≤ 60 s (lo garantiza el CHECK del
// esquema). `Consumed` se marca en la misma transacción del intercambio: sin eso,
// dos intercambios concurrentes del mismo código emitirían dos juegos de tokens.
type AuthCodeRow struct {
	ID                  uuid.UUID `db:"id"`
	Code                string    `db:"code"`
	ClientID            string    `db:"client_id"`
	UserID              uuid.UUID `db:"user_id"`
	CodeChallenge       string    `db:"code_challenge"`
	CodeChallengeMethod string    `db:"code_challenge_method"`
	RedirectURI         string    `db:"redirect_uri"`
	Scopes              []string  `db:"scopes"`
	ExpiresAt           time.Time `db:"expires_at"`
	Consumed            bool      `db:"consumed"`
	CreatedAt           time.Time `db:"created_at"`
}
