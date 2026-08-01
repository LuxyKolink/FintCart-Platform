package storer

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

// Pruebas de la capa de persistencia contra un driver SQL SIMULADO (§Calidad:
// `go-sqlmock`, sin base de datos viva).
//
// Qué comprueban y qué no. `go-sqlmock` no ejecuta SQL: verifica que se envía la
// consulta esperada con los argumentos esperados y devuelve las filas que se le
// indiquen. Eso deja fuera todo lo que decide PostgreSQL —los CHECK, la unicidad, el
// comportamiento de `CITEXT`— y esa parte la cubre T046 contra una base real.
//
// Lo que sí cubre es exactamente lo que se rompe al editar este archivo: que el
// `WHERE` lleve las condiciones que hacen atómica una operación, que un `sql.ErrNoRows`
// se traduzca al centinela correcto, y que el número de filas afectadas se interprete
// como conflicto y no como éxito silencioso.

func newMockStorer(t *testing.T) (*PostgresStorer, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	require.NoError(t, err)
	t.Cleanup(func() {
		// `ExpectationsWereMet` es lo que convierte estas pruebas en algo más que un
		// «no falló»: detecta la consulta que se esperaba y NO se ejecutó.
		require.NoError(t, mock.ExpectationsWereMet())
		_ = db.Close()
	})

	return NewPostgresStorer(sqlx.NewDb(db, "pgx")), mock
}

// ── credentials ─────────────────────────────────────────────────────────────

func TestCreateCredentialIsIdempotent(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	row := CredentialRow{
		ID:           uuid.New(),
		Email:        "ana@fintcart.co",
		PasswordHash: "$argon2id$...",
		LoginStatus:  StatusPendingVerification,
	}

	// `ON CONFLICT (id) DO NOTHING` es lo que permite reanudar la saga de registro
	// (D-04) tras un reinicio sin que el reintento se compense borrando una cuenta
	// que en realidad se creó bien.
	mock.ExpectExec(regexp.QuoteMeta("ON CONFLICT (id) DO NOTHING")).
		WithArgs(row.ID, row.Email, row.PasswordHash, row.LoginStatus).
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, s.CreateCredential(context.Background(), row))
}

func TestCreateCredentialTranslatesUniqueViolation(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	row := CredentialRow{ID: uuid.New(), Email: "ana@fintcart.co", PasswordHash: "h", LoginStatus: StatusPendingVerification}

	mock.ExpectExec("INSERT INTO credentials").
		WithArgs(row.ID, row.Email, row.PasswordHash, row.LoginStatus).
		WillReturnError(&pgconn.PgError{Code: pgUniqueViolation})

	// El choque por correo duplicado (FR-001) tiene que llegar arriba como conflicto,
	// no como un error interno: son respuestas distintas para el cliente.
	require.ErrorIs(t, s.CreateCredential(context.Background(), row), ErrConflict)
}

// hash de ejemplo con la forma real (SHA-256 hex) que produce el servidor.
const testTokenHash = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

func TestActivateCredentialAcceptsOnlyActivatableStates(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := uuid.New()

	// El estado de origen va en el WHERE, no en una comprobación posterior: así una
	// cuenta ya `anonymized` no puede volver a `active` por un evento de verificación
	// que llegue tarde (FR-030).
	mock.ExpectExec("UPDATE credentials").
		WithArgs(id, StatusActive, StatusPendingVerification, testTokenHash).
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, s.ActivateCredential(context.Background(), id, testTokenHash))
}

func TestActivateCredentialRejectsATokenThatDoesNotMatch(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := uuid.New()

	mock.ExpectExec("UPDATE credentials").
		WithArgs(id, StatusActive, StatusPendingVerification, testTokenHash).
		WillReturnResult(sqlmock.NewResult(0, 0))

	// Cero filas afectadas NO es éxito. Sin esta comprobación, verificar con un token
	// equivocado devolvería `nil` y la saga activaría la cuenta como si el titular
	// hubiera probado que controla el buzón.
	require.ErrorIs(t,
		s.ActivateCredential(context.Background(), id, testTokenHash),
		ErrVerificationTokenInvalid)
}

// El token viaja HASHEADO hasta el SQL. Es la propiedad que hace que un volcado de
// `credentials` —o un log de consultas lentas— no contenga ningún enlace utilizable.
func TestActivateCredentialNeverPutsTheTokenInClearIntoTheQuery(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := uuid.New()

	mock.ExpectExec("UPDATE credentials").
		WithArgs(id, StatusActive, StatusPendingVerification, testTokenHash).
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, s.ActivateCredential(context.Background(), id, testTokenHash))
	// `WithArgs` ya falla si llega otra cosa; esto comprueba que no quedó ninguna
	// expectativa sin consumir, es decir, que se ejecutó exactamente esa sentencia.
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSetVerificationTokenRequiresAPendingAccount(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := uuid.New()
	expires := time.Now().UTC().Add(time.Hour)

	mock.ExpectExec("UPDATE credentials").
		WithArgs(id, testTokenHash, expires, StatusPendingVerification).
		WillReturnResult(sqlmock.NewResult(0, 0))

	// Sin fila afectada la cuenta no estaba pendiente: o ya se verificó, o está
	// anonimizada. Emitirle un token a la segunda le abriría una vía de regreso que
	// FR-030 cierra de forma permanente.
	require.ErrorIs(t,
		s.SetVerificationToken(context.Background(), id, testTokenHash, expires),
		ErrConflict)
}

func TestGetCredentialByEmailTranslatesNoRows(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)

	mock.ExpectQuery("SELECT .* FROM credentials WHERE email").
		WithArgs("nadie@fintcart.co").
		WillReturnError(sql.ErrNoRows)

	// `sql.ErrNoRows` se traduce al centinela de esta capa para que `server` no tenga
	// que importar `database/sql` (Principio IX).
	_, err := s.GetCredentialByEmail(context.Background(), "nadie@fintcart.co")
	require.ErrorIs(t, err, ErrNotFound)
}

func TestGetCredentialByEmailReturnsRow(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := uuid.New()
	now := time.Now().UTC()

	mock.ExpectQuery("SELECT .* FROM credentials WHERE email").
		WithArgs("ana@fintcart.co").
		WillReturnRows(sqlmock.
			NewRows([]string{"id", "email", "password_hash", "login_status", "created_at", "updated_at"}).
			AddRow(id, "ana@fintcart.co", "$argon2id$...", StatusActive, now, now))

	row, err := s.GetCredentialByEmail(context.Background(), "ana@fintcart.co")
	require.NoError(t, err)
	require.Equal(t, id, row.ID)
	require.Equal(t, StatusActive, row.LoginStatus)
}

func TestUpdatePasswordHashExcludesAnonymizedAccounts(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := uuid.New()

	// El tercer argumento es `StatusAnonymized` en un `<>`: sin ese filtro, un cambio
	// de contraseña sobre una cuenta anonimizada escribiría un hash utilizable sobre
	// el valor inutilizable de FR-030 y la cuenta volvería a ser accesible.
	mock.ExpectExec("UPDATE credentials").
		WithArgs(id, "$argon2id$nuevo", StatusAnonymized).
		WillReturnResult(sqlmock.NewResult(0, 0))

	require.ErrorIs(t, s.UpdatePasswordHash(context.Background(), id, "$argon2id$nuevo"), ErrConflict)
}

// ── oauth_clients ───────────────────────────────────────────────────────────

func TestGetOAuthClientScansArrays(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := uuid.New()

	mock.ExpectQuery("SELECT .* FROM oauth_clients").
		WithArgs("fintcart-spa").
		WillReturnRows(sqlmock.
			NewRows([]string{"id", "client_id", "client_secret_hash", "grant_types", "redirect_uris", "scopes", "is_public", "created_at"}).
			AddRow(id, "fintcart-spa", nil,
				pq.Array([]string{"authorization_code", "refresh_token"}),
				pq.Array([]string{"https://app.fintcart.co/callback"}),
				pq.Array([]string{"catalog:read"}),
				true, time.Now().UTC()))

	client, err := s.GetOAuthClient(context.Background(), "fintcart-spa")
	require.NoError(t, err)
	require.True(t, client.IsPublic)
	// `ClientSecretHash` nil es lo que distingue un cliente público de uno
	// confidencial. Colapsarlo a "" haría indistinguible «sin secreto» de «secreto
	// vacío», que es la confusión que el CHECK del esquema existe para impedir.
	require.Nil(t, client.ClientSecretHash)
	require.Equal(t, []string{"authorization_code", "refresh_token"}, client.GrantTypes)
	require.Equal(t, []string{"https://app.fintcart.co/callback"}, client.RedirectURIs)
}

func TestGetOAuthClientTranslatesNoRows(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)

	mock.ExpectQuery("SELECT .* FROM oauth_clients").
		WithArgs("inexistente").
		WillReturnError(sql.ErrNoRows)

	_, err := s.GetOAuthClient(context.Background(), "inexistente")
	require.ErrorIs(t, err, ErrNotFound)
}

// ── authorization_codes ─────────────────────────────────────────────────────

func TestInsertAuthCodeDoesNotSendCreatedAt(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	row := AuthCodeRow{
		ID:                  uuid.New(),
		Code:                "codigo-opaco",
		ClientID:            "fintcart-spa",
		UserID:              uuid.New(),
		CodeChallenge:       "challenge",
		CodeChallengeMethod: "S256",
		RedirectURI:         "https://app.fintcart.co/callback",
		Scopes:              []string{"catalog:read"},
		ExpiresAt:           time.Now().UTC().Add(45 * time.Second),
	}

	// Nueve argumentos, sin `created_at`: lo pone la base. El CHECK
	// `authorization_codes_ttl_short` compara `expires_at` con `created_at`, así que
	// enviarlo desde el reloj del proceso haría que una deriva contra el reloj del
	// servidor rechazara códigos válidos.
	mock.ExpectExec("INSERT INTO authorization_codes").
		WithArgs(row.ID, row.Code, row.ClientID, row.UserID,
			row.CodeChallenge, row.CodeChallengeMethod, row.RedirectURI,
			pq.Array(row.Scopes), row.ExpiresAt).
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, s.InsertAuthCode(context.Background(), row))
}

// TestConsumeAuthCodeMarksAndReturnsAtomically es la prueba central de T050.
//
// Comprueba la FORMA de la sentencia, no solo su resultado: `UPDATE ... RETURNING`
// con `NOT consumed AND expires_at > now()` en el WHERE. Un `SELECT` seguido de un
// `UPDATE` dejaría una ventana en la que dos canjes concurrentes del mismo código
// obtienen tokens los dos, que es el ataque que PKCE pretende cerrar.
func TestConsumeAuthCodeMarksAndReturnsAtomically(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id, userID := uuid.New(), uuid.New()
	now := time.Now().UTC()

	mock.ExpectQuery(`UPDATE authorization_codes\s+SET consumed = TRUE\s+WHERE code = \$1 AND NOT consumed AND expires_at > now\(\)\s+RETURNING`).
		WithArgs("codigo-opaco").
		WillReturnRows(sqlmock.
			NewRows([]string{"id", "code", "client_id", "user_id", "code_challenge",
				"code_challenge_method", "redirect_uri", "scopes", "expires_at", "consumed", "created_at"}).
			AddRow(id, "codigo-opaco", "fintcart-spa", userID, "challenge", "S256",
				"https://app.fintcart.co/callback", pq.Array([]string{"catalog:read"}),
				now.Add(time.Minute), true, now))

	row, err := s.ConsumeAuthCode(context.Background(), "codigo-opaco")
	require.NoError(t, err)
	require.True(t, row.Consumed)
	require.Equal(t, userID, row.UserID)
	require.Equal(t, []string{"catalog:read"}, row.Scopes)
}

func TestConsumeAuthCodeConflictsWhenAlreadyUsedOrExpired(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)

	mock.ExpectQuery("UPDATE authorization_codes").
		WithArgs("codigo-opaco").
		WillReturnError(sql.ErrNoRows)

	// «No existe», «ya consumido» y «expirado» colapsan en el MISMO error: los tres
	// son la misma respuesta para quien canjea, y distinguirlos le diría a un atacante
	// si el código que probó llegó a existir.
	_, err := s.ConsumeAuthCode(context.Background(), "codigo-opaco")
	require.ErrorIs(t, err, ErrConflict)
	require.False(t, errors.Is(err, ErrNotFound))
}

func TestDeleteExpiredAuthCodesReturnsCount(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	cutoff := time.Now().UTC()

	mock.ExpectExec("DELETE FROM authorization_codes").
		WithArgs(cutoff).
		WillReturnResult(sqlmock.NewResult(0, 7))

	n, err := s.DeleteExpiredAuthCodes(context.Background(), cutoff)
	require.NoError(t, err)
	require.Equal(t, int64(7), n)
}

// ── execTx ──────────────────────────────────────────────────────────────────

func TestExecTxCommitsOnSuccess(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)

	mock.ExpectBegin()
	mock.ExpectCommit()

	require.NoError(t, s.execTx(context.Background(), func(*sqlx.Tx) error { return nil }))
}

func TestExecTxRollsBackOnError(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	sentinel := errors.New("fallo dentro de la transacción")

	mock.ExpectBegin()
	mock.ExpectRollback()

	// La causa se preserva a través del rollback (Principio XI regla 6): quien lee el
	// log necesita saber por qué falló la operación, no por qué se deshizo.
	err := s.execTx(context.Background(), func(*sqlx.Tx) error { return sentinel })
	require.ErrorIs(t, err, sentinel)
}
