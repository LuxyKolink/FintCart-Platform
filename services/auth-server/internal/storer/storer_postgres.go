package storer

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jmoiron/sqlx"

	// `pq.Array` es lo ÚNICO que se usa de `lib/pq`; el driver sigue siendo `pgx`
	// (ver el import en blanco de `cmd/auth/main.go`). El motivo es que `database/sql`
	// no sabe nada de arrays de PostgreSQL: sin un `Valuer`/`Scanner` que traduzca
	// entre `[]string` y el literal `{a,b}`, las columnas `TEXT[]` de `oauth_clients`
	// y `authorization_codes` habría que serializarlas a mano en cada consulta.
	// `pq.Array` hace exactamente esa traducción y no toca la conexión.
	"github.com/lib/pq"
)

// PostgresStorer es la implementación de [Storer] sobre `auth_db`.
type PostgresStorer struct {
	db *sqlx.DB
}

// NewPostgresStorer construye el storer sobre un pool ya abierto (Principio X: la
// configuración se lee en `cmd/auth/main.go`, no aquí).
func NewPostgresStorer(db *sqlx.DB) *PostgresStorer {
	return &PostgresStorer{db: db}
}

// execTx ejecuta `fn` en una transacción: confirma si devuelve nil, revierte en
// cualquier otro caso (Principio XI regla 4).
//
// Único lugar del servicio donde se abre, confirma o revierte una transacción. El
// `*sqlx.Tx` no aparece en la interfaz [Storer]: el control transaccional no cruza
// hacia arriba, porque si `server` pudiera decidir el alcance de una transacción
// acabaría decidiendo el alcance de un bloqueo de base de datos.
func (s *PostgresStorer) execTx(ctx context.Context, fn func(tx *sqlx.Tx) error) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return wrap("abrir transacción", err)
	}

	if err := fn(tx); err != nil {
		// `sql.ErrTxDone` significa que la transacción ya había terminado (por
		// ejemplo, contexto cancelado); no es un fallo del rollback y no debe tapar
		// el error original.
		if rbErr := tx.Rollback(); rbErr != nil && !errors.Is(rbErr, sql.ErrTxDone) {
			return wrap("revertir transacción", errors.Join(err, rbErr))
		}
		return wrap("transacción abortada", err)
	}

	if err := tx.Commit(); err != nil {
		return wrap("confirmar transacción", err)
	}
	return nil
}

// ── credentials ─────────────────────────────────────────────────────────────

// createCredentialQuery inserta la credencial de forma IDEMPOTENTE.
//
// `ON CONFLICT (id) DO NOTHING` es lo que hace que el paso se pueda reintentar: la
// creación de la credencial es un paso de la saga de registro (D-04), y una saga se
// reanuda tras un reinicio. Sin esto, el reintento chocaría con la clave primaria y
// la saga se compensaría —borrando una cuenta que en realidad se creó bien.
//
// El conflicto por `email` NO se silencia: ese sí es un error real (FR-001 exige
// unicidad) y tiene que llegar arriba como [ErrConflict].
//
// El `nolint` de abajo cubre un falso positivo recurrente de gosec en esta capa: la
// regla G101 se dispara por el NOMBRE de la constante («Credential», «Password») y
// no por su contenido, que es SQL parametrizado sin ningún valor literal.
//
//nolint:gosec // G101 falso positivo: consulta SQL, no credencial.
const createCredentialQuery = `
INSERT INTO credentials (id, email, password_hash, login_status)
VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO NOTHING`

// CreateCredential inserta la credencial en `pending_verification`.
func (s *PostgresStorer) CreateCredential(ctx context.Context, c CredentialRow) error {
	_, err := s.db.ExecContext(ctx, createCredentialQuery, c.ID, c.Email, c.PasswordHash, c.LoginStatus)
	if err != nil {
		if isUniqueViolation(err) {
			return wrap("crear credencial", ErrConflict)
		}
		return wrap("crear credencial", err)
	}
	return nil
}

// setVerificationTokenQuery guarda el hash del token y su caducidad.
//
// El WHERE exige `pending_verification`: emitir un token para una cuenta ya activa
// no tendría efecto útil, y para una anonimizada sería una vía de resurrección
// (FR-030 la deja inutilizable de forma PERMANENTE).
//
//nolint:gosec // G101 falso positivo: consulta SQL, no credencial.
const setVerificationTokenQuery = `
UPDATE credentials
SET verification_token_hash = $2, verification_token_expires_at = $3, updated_at = now()
WHERE id = $1 AND login_status = $4`

// SetVerificationToken guarda el token de verificación, reemplazando al anterior.
//
// El reemplazo es intencional y es lo que hace correcto el reenvío del correo: si
// los tokens se acumularan, un enlace de un correo antiguo —o interceptado— seguiría
// activando la cuenta después de que el usuario pidiera uno nuevo.
func (s *PostgresStorer) SetVerificationToken(
	ctx context.Context,
	userID uuid.UUID,
	tokenHash string,
	expiresAt time.Time,
) error {
	res, err := s.db.ExecContext(ctx, setVerificationTokenQuery,
		userID, tokenHash, expiresAt, StatusPendingVerification)
	if err != nil {
		return wrap("guardar token de verificación", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return wrap("guardar token de verificación", err)
	}
	if n == 0 {
		return wrap("guardar token de verificación", ErrConflict)
	}
	return nil
}

// activateCredentialQuery aplica la transición `pending_verification → active`
// comprobando el token en la misma sentencia.
//
// El estado de origen va en el WHERE y no se comprueba después de leer: así la
// transición es atómica y una cuenta ya `anonymized` no puede volver a `active` por
// un evento de verificación que llegue tarde (FR-030 la deja inutilizable de forma
// permanente).
//
// Las dos ramas del OR no son redundantes:
//
//   - La primera exige token válido y no caducado. Es la verificación de verdad.
//     Al aplicarse, los dos campos vuelven a NULL: el token es de UN SOLO USO, así
//     que un enlace reenviado por el usuario a un tercero ya no sirve.
//   - La segunda acepta la cuenta YA activa sin mirar el token. Sin ella, el
//     reintento del paso de la saga —cuya entrega es at-least-once (D-07)— fallaría
//     sobre una cuenta que él mismo acaba de activar, y la saga compensaría un
//     registro correcto. El precio es que quien ya conozca un `user_id` activo puede
//     confirmar que lo está; lo mismo que ya revela el login, y muy por debajo de
//     poder activarla.
//
//nolint:gosec // G101 falso positivo: consulta SQL, no credencial.
const activateCredentialQuery = `
UPDATE credentials
SET login_status = $2,
    updated_at = now(),
    verification_token_hash = NULL,
    verification_token_expires_at = NULL
WHERE id = $1
  AND ( (login_status = $3
         AND verification_token_hash = $4
         AND verification_token_expires_at > now())
     OR login_status = $2 )`

// ActivateCredential mueve `pending_verification` → `active` si el token cuadra.
//
// Devuelve [ErrVerificationTokenInvalid] para todo lo que no active: token
// equivocado, ya usado, caducado, cuenta anonimizada o `user_id` inexistente. La
// indistinción es deliberada — ver el centinela.
func (s *PostgresStorer) ActivateCredential(ctx context.Context, userID uuid.UUID, tokenHash string) error {
	res, err := s.db.ExecContext(ctx, activateCredentialQuery,
		userID, StatusActive, StatusPendingVerification, tokenHash)
	if err != nil {
		return wrap("activar credencial", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return wrap("activar credencial", err)
	}
	if n == 0 {
		return wrap("activar credencial", ErrVerificationTokenInvalid)
	}
	return nil
}

//nolint:gosec // G101 falso positivo: lista de columnas, no credencial.
const selectCredentialColumns = `id, email, password_hash, login_status, created_at, updated_at`

// GetCredentialByEmail es la lectura del login.
//
// La comparación de correo es case-insensitive porque la columna es `CITEXT`: es la
// base la que normaliza, no este código. Hacerlo aquí con un `LOWER()` en el WHERE
// impediría además usar el índice único de la columna.
func (s *PostgresStorer) GetCredentialByEmail(ctx context.Context, email string) (CredentialRow, error) {
	var row CredentialRow
	err := s.db.GetContext(ctx, &row,
		`SELECT `+selectCredentialColumns+` FROM credentials WHERE email = $1`, email)
	if errors.Is(err, sql.ErrNoRows) {
		return CredentialRow{}, wrap("leer credencial por correo", ErrNotFound)
	}
	if err != nil {
		return CredentialRow{}, wrap("leer credencial por correo", err)
	}
	return row, nil
}

// GetCredential lee la credencial por identificador.
func (s *PostgresStorer) GetCredential(ctx context.Context, userID uuid.UUID) (CredentialRow, error) {
	var row CredentialRow
	err := s.db.GetContext(ctx, &row,
		`SELECT `+selectCredentialColumns+` FROM credentials WHERE id = $1`, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return CredentialRow{}, wrap("leer credencial", ErrNotFound)
	}
	if err != nil {
		return CredentialRow{}, wrap("leer credencial", err)
	}
	return row, nil
}

// updatePasswordHashQuery excluye explícitamente las cuentas anonimizadas.
//
// Sin el filtro de estado, un cambio de contraseña sobre una cuenta anonimizada
// escribiría un hash utilizable sobre el valor inutilizable que puso FR-030, y la
// cuenta volvería a ser accesible.
//
//nolint:gosec // G101 falso positivo: consulta SQL, no credencial.
const updatePasswordHashQuery = `
UPDATE credentials
SET password_hash = $2, updated_at = now()
WHERE id = $1 AND login_status <> $3`

// UpdatePasswordHash sustituye el hash de la contraseña.
func (s *PostgresStorer) UpdatePasswordHash(ctx context.Context, userID uuid.UUID, hash string) error {
	res, err := s.db.ExecContext(ctx, updatePasswordHashQuery, userID, hash, StatusAnonymized)
	if err != nil {
		return wrap("actualizar hash de contraseña", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return wrap("actualizar hash de contraseña", err)
	}
	if n == 0 {
		return wrap("actualizar hash de contraseña", ErrConflict)
	}
	return nil
}

// pgUniqueViolation es el SQLSTATE 23505 de PostgreSQL.
const pgUniqueViolation = "23505"

// isUniqueViolation distingue el choque con un índice único del resto de fallos.
//
// Se interroga el CÓDIGO SQLSTATE y no el texto del mensaje: el texto depende del
// idioma configurado en el servidor y del nombre de la constraint, así que una
// comparación por substring dejaría de funcionar el día que alguien renombre un
// índice o cambie `lc_messages`.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == pgUniqueViolation
	}
	return false
}

// AnonymizeCredential reescribe la credencial y descarta los códigos de
// autorización pendientes del usuario, en una sola transacción.
//
// Las dos escrituras van juntas porque un código sin consumir sobreviviente
// permitiría emitir tokens para una cuenta ya anonimizada — exactamente lo que
// FR-030 prohíbe.
func (s *PostgresStorer) AnonymizeCredential(ctx context.Context, userID uuid.UUID, opaqueEmail string) error {
	_, _ = userID, opaqueEmail
	return s.execTx(ctx, func(_ *sqlx.Tx) error {
		// T162: UPDATE credentials (email opaco, hash inutilizable, `anonymized`)
		// + DELETE de authorization_codes no consumidos del usuario.
		return ErrNotImplemented
	})
}

// ── oauth_clients ───────────────────────────────────────────────────────────

const getOAuthClientQuery = `
SELECT id, client_id, client_secret_hash, grant_types, redirect_uris, scopes, is_public, created_at
FROM oauth_clients
WHERE client_id = $1`

// GetOAuthClient lee el registro del cliente OAuth2.
//
// Las columnas se enumeran en lugar de usar `SELECT *`: con `*`, añadir una columna
// en una migración rompe el escaneo de `sqlx` en tiempo de EJECUCIÓN, y el fallo
// aparece en la primera petición después del despliegue en vez de al compilar.
func (s *PostgresStorer) GetOAuthClient(ctx context.Context, clientID string) (OAuthClientRow, error) {
	var row OAuthClientRow
	err := s.db.QueryRowxContext(ctx, getOAuthClientQuery, clientID).Scan(
		&row.ID, &row.ClientID, &row.ClientSecretHash,
		pq.Array(&row.GrantTypes), pq.Array(&row.RedirectURIs), pq.Array(&row.Scopes),
		&row.IsPublic, &row.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return OAuthClientRow{}, wrap("leer cliente oauth", ErrNotFound)
	}
	if err != nil {
		return OAuthClientRow{}, wrap("leer cliente oauth", err)
	}
	return row, nil
}

// ── authorization_codes ─────────────────────────────────────────────────────

const insertAuthCodeQuery = `
INSERT INTO authorization_codes
    (id, code, client_id, user_id, code_challenge, code_challenge_method, redirect_uri, scopes, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

// InsertAuthCode persiste un código de autorización recién emitido.
//
// `created_at` y `consumed` los pone la base con sus valores por defecto y NO se
// envían desde aquí: el CHECK `authorization_codes_ttl_short` compara `expires_at`
// con `created_at`, así que fijar el segundo desde el reloj del proceso haría que
// una deriva entre ese reloj y el del servidor de base de datos rechazara códigos
// perfectamente válidos.
func (s *PostgresStorer) InsertAuthCode(ctx context.Context, c AuthCodeRow) error {
	_, err := s.db.ExecContext(ctx, insertAuthCodeQuery,
		c.ID, c.Code, c.ClientID, c.UserID,
		c.CodeChallenge, c.CodeChallengeMethod, c.RedirectURI,
		pq.Array(c.Scopes), c.ExpiresAt,
	)
	if err != nil {
		return wrap("insertar código de autorización", err)
	}
	return nil
}

// consumeAuthCodeQuery marca y devuelve en UNA sentencia.
//
// La forma importa y no es negociable: un `SELECT` seguido de un `UPDATE` deja una
// ventana en la que dos intercambios concurrentes del mismo código obtienen tokens
// los dos. `UPDATE ... RETURNING` es atómico —PostgreSQL toma el bloqueo de fila
// antes de escribir—, así que el segundo intercambio no encuentra nada que marcar.
//
// `NOT consumed AND expires_at > now()` van en el WHERE y no en una comprobación
// posterior en Go por lo mismo: comprobarlas después reabriría la ventana.
const consumeAuthCodeQuery = `
UPDATE authorization_codes
SET consumed = TRUE
WHERE code = $1 AND NOT consumed AND expires_at > now()
RETURNING id, code, client_id, user_id, code_challenge, code_challenge_method,
          redirect_uri, scopes, expires_at, consumed, created_at`

// ConsumeAuthCode marca y devuelve el código en una sola sentencia.
//
// Devuelve [ErrConflict] —y no [ErrNotFound]— cuando no hay fila que actualizar: el
// caso cubre «no existe», «ya consumido» y «expirado», y los tres son la misma
// respuesta para quien canjea. Distinguirlos le diría a un atacante si el código que
// probó llegó a existir.
func (s *PostgresStorer) ConsumeAuthCode(ctx context.Context, code string) (AuthCodeRow, error) {
	var row AuthCodeRow
	err := s.db.QueryRowxContext(ctx, consumeAuthCodeQuery, code).Scan(
		&row.ID, &row.Code, &row.ClientID, &row.UserID,
		&row.CodeChallenge, &row.CodeChallengeMethod, &row.RedirectURI,
		pq.Array(&row.Scopes), &row.ExpiresAt, &row.Consumed, &row.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return AuthCodeRow{}, wrap("consumir código de autorización", ErrConflict)
	}
	if err != nil {
		return AuthCodeRow{}, wrap("consumir código de autorización", err)
	}
	return row, nil
}

const deleteExpiredAuthCodesQuery = `DELETE FROM authorization_codes WHERE expires_at < $1`

// DeleteExpiredAuthCodes es el barrido de mantenimiento.
//
// Borra por `expires_at` y no por `consumed`: un código consumido sigue siendo útil
// un rato para detectar un intento de reutilización, mientras que uno expirado ya no
// puede canjearse de ninguna manera.
func (s *PostgresStorer) DeleteExpiredAuthCodes(ctx context.Context, olderThan time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, deleteExpiredAuthCodesQuery, olderThan)
	if err != nil {
		return 0, wrap("borrar códigos expirados", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, wrap("contar códigos borrados", err)
	}
	return n, nil
}
