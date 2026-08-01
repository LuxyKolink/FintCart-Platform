package storer

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jmoiron/sqlx"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

// Pruebas de la capa de persistencia contra un driver SQL SIMULADO (T090,
// §Calidad: `go-sqlmock`, sin base de datos viva).
//
// Qué comprueban y qué no. `go-sqlmock` NO ejecuta SQL: verifica que se envía la
// consulta esperada con los argumentos esperados y devuelve las filas que se le
// indiquen. Queda fuera todo lo que decide PostgreSQL —los CHECK, la unicidad, el
// comportamiento de `CITEXT`, el resultado real de un `ON CONFLICT`—, y esa parte
// se cubre contra una base real en las pruebas de integración de la saga.
//
// Lo que sí cubre es exactamente lo que se rompe al editar estos archivos:
//
//   - que las condiciones que hacen ATÓMICA una operación estén en la consulta y
//     no en un `if` de Go, donde otro hilo cabe entre la lectura y la escritura;
//   - que las calificaciones crucen la frontera del driver como decimal exacto y
//     nunca como `float64` (Principio VIII);
//   - que un `sql.ErrNoRows` se traduzca al centinela correcto, y que «no existe»
//     y «estado equivocado» no acaben siendo el mismo error;
//   - que el recálculo de puntos sea un recálculo y no un incremento, que es de
//     lo que depende la convergencia del reintento (D-07).

const (
	testUserID    = "3f0f8b2e-2c53-4a2c-9f0a-1d2e3f4a5b6c"
	testQuizID    = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
	testArticleID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f"
	testNotifID   = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
)

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

// pgErr construye un error del driver con un SQLSTATE concreto.
func pgErr(code string) error {
	return &pgconn.PgError{Code: code}
}

func mustUUID(t *testing.T, s string) uuid.UUID {
	t.Helper()
	id, err := uuid.Parse(s)
	require.NoError(t, err)
	return id
}

// ── perfil ──────────────────────────────────────────────────────────────────

func TestCreateProfileWritesTheFourTablesInOneTransaction(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO profiles").
		WithArgs(id, "ana@fintcart.co", "Ana").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO preferences").WithArgs(id).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// El progreso se crea junto con el perfil: sin esta fila, la barra de progreso
	// de una cuenta recién registrada respondería «no encontrado» en lugar de cero.
	mock.ExpectExec("INSERT INTO progress").WithArgs(id).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO roles_assignment").WithArgs(id, "usuario_final").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	row := ProfileRow{ID: id, Email: "ana@fintcart.co", DisplayName: "Ana"}
	require.NoError(t, s.CreateProfile(context.Background(), row, "usuario_final"))
}

func TestCreateProfileIsIdempotentByConstruction(t *testing.T) {
	t.Parallel()

	// La idempotencia del paso de registro (D-04) la da el `ON CONFLICT DO NOTHING`
	// de las CUATRO escrituras, no un `if exists` en Go. Se comprueba sobre el texto
	// de la consulta porque un driver simulado no puede ejecutar el conflicto: lo que
	// esta prueba impide es que alguien quite la cláusula al editar el SQL, y con
	// ella la capacidad de la saga de reintentar tras un reinicio.
	for _, q := range []string{insertProfileQuery, insertPreferencesQuery, insertProgressQuery, insertRoleQuery} {
		require.Contains(t, q, "ON CONFLICT")
		require.Contains(t, q, "DO NOTHING")
	}
	// El arbitraje es sobre la CLAVE PRIMARIA. Si fuera sobre el correo, dos
	// registros distintos con el mismo correo se fundirían en silencio en vez de
	// rechazarse (FR-001).
	require.Contains(t, insertProfileQuery, "ON CONFLICT (id)")
}

func TestCreateProfileTranslatesDuplicateEmail(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO profiles").
		WithArgs(id, "ana@fintcart.co", "Ana").
		WillReturnError(pgErr(pgUniqueViolation))
	mock.ExpectRollback()

	row := ProfileRow{ID: id, Email: "ana@fintcart.co", DisplayName: "Ana"}
	err := s.CreateProfile(context.Background(), row, "usuario_final")

	// El correo ya usado por OTRA cuenta activa tiene que llegar arriba como
	// conflicto y no como error interno: son respuestas distintas para el cliente
	// (FR-001).
	require.ErrorIs(t, err, ErrConflict)
}

func TestMarkEmailVerifiedRejectsAnonymizedAccounts(t *testing.T) {
	t.Parallel()

	// El estado va en el WHERE, no en una comprobación previa. Sin él, un evento de
	// verificación que llegue tarde reactivaría el correo de una cuenta que FR-030
	// dejó inutilizable de forma permanente.
	require.Contains(t, markEmailVerifiedQuery, "account_status = 'active'")
}

func TestMarkEmailVerifiedDistinguishesMissingFromAnonymized(t *testing.T) {
	t.Parallel()
	id := mustUUID(t, testUserID)

	cases := map[string]struct {
		exists bool
		want   error
	}{
		// El perfil no está: el registro se compensó o nunca ocurrió.
		"perfil ausente": {exists: false, want: ErrNotFound},
		// El perfil está pero no es 'active': la verificación llegó tarde.
		"perfil anonimizado": {exists: true, want: ErrConflict},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			s, mock := newMockStorer(t)

			mock.ExpectQuery("UPDATE profiles").WithArgs(id).
				WillReturnRows(sqlmock.NewRows([]string{"id"}))
			mock.ExpectQuery("SELECT EXISTS").WithArgs(id).
				WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(tc.exists))

			// Dos errores distintos para dos causas distintas: con uno solo, el
			// operador tendría que ir a la base a averiguar cuál de las dos ocurrió.
			require.ErrorIs(t, s.MarkEmailVerified(context.Background(), id), tc.want)
		})
	}
}

func TestGetProfileTranslatesNoRows(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	mock.ExpectQuery("SELECT .* FROM profiles WHERE id").WithArgs(id).
		WillReturnRows(sqlmock.NewRows([]string{}))

	_, err := s.GetProfile(context.Background(), id)
	require.ErrorIs(t, err, ErrNotFound)
}

func TestGetRolesOrdersDeterministically(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	// El orden es explícito y no el que devuelva el planificador: los roles acaban
	// en un claim del JWT, y dos tokens con los mismos roles en distinto orden serían
	// bytes distintos sin ser semánticamente distintos.
	mock.ExpectQuery(regexp.QuoteMeta("ORDER BY role")).WithArgs(id).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "role", "assigned_at"}).
			AddRow(testUserID, "editor", time.Now()).
			AddRow(testUserID, "usuario_final", time.Now()))

	roles, err := s.GetRoles(context.Background(), id)
	require.NoError(t, err)
	require.Equal(t, []string{"editor", "usuario_final"}, []string{roles[0].Role, roles[1].Role})
}

func TestGetRolesWithoutRowsIsNotAnError(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	mock.ExpectQuery("FROM roles_assignment").WithArgs(id).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "role", "assigned_at"}))

	roles, err := s.GetRoles(context.Background(), id)
	// Sin roles ≠ no encontrado: `GetAuthContext` ya falla antes si el perfil no
	// existe, así que una lista vacía aquí significa literalmente «sin roles».
	require.NoError(t, err)
	require.Empty(t, roles)
}

// ── progreso: monotonía e idempotencia (D-07, FR-014) ───────────────────────

// expectApplyBestScore programa las tres sentencias de ApplyBestScore y hace que
// el recálculo devuelva `points`.
func expectApplyBestScore(mock sqlmock.Sqlmock, id, quiz uuid.UUID, score decimal.Decimal, points int32) {
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO progress").WithArgs(id).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO quiz_best_score").
		// El puntaje cruza el driver como decimal exacto. Si se convirtiera a
		// `float64` en algún punto del camino, esta comparación con el valor
		// esperado dejaría de cuadrar para valores como 85.55 (Principio VIII).
		WithArgs(id, quiz, score).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("UPDATE progress").WithArgs(id).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "points", "updated_at"}).
			AddRow(id.String(), points, time.Now()))
	mock.ExpectCommit()
}

func TestApplyBestScoreGuardsMonotonicityInTheStatement(t *testing.T) {
	t.Parallel()

	// La comparación vive en el `WHERE` del `DO UPDATE`. Hecha fuera de la base
	// —leer el mejor puntaje, comparar en Go, escribir— dejaría hueco para que otro
	// intento se colara entre la lectura y la escritura, y el peor de los dos
	// ganaría la carrera.
	require.Contains(t, applyBestScoreQuery,
		"WHERE EXCLUDED.best_score > quiz_best_score.best_score")
}

func TestApplyBestScoreRecomputesInsteadOfIncrementing(t *testing.T) {
	t.Parallel()

	// La diferencia entre `points = (SELECT SUM(...))` y `points = points + delta`
	// es la diferencia entre un reintento que converge y uno que infla el progreso
	// de forma permanente cada vez que RabbitMQ reentrega el evento (D-07).
	require.Contains(t, recomputeProgressQuery, "SUM(best_score)")
	require.NotContains(t, recomputeProgressQuery, "points +")
	// FLOOR y no ROUND: redondear hacia arriba regalaría un punto no obtenido, y
	// además rompería la monotonía sobre la que descansa toda la idempotencia.
	require.Contains(t, recomputeProgressQuery, "FLOOR(SUM(best_score))")
}

func TestApplyBestScoreLocksProgressBeforeSumming(t *testing.T) {
	t.Parallel()

	// `DO UPDATE` y no `DO NOTHING`: solo el primero toma el bloqueo de fila. Sin
	// él, dos intentos concurrentes del mismo usuario en cuestionarios distintos
	// calculan cada uno una suma que ignora al otro, y el último en confirmar deja
	// unos puntos a los que le falta un cuestionario entero.
	require.Contains(t, lockProgressQuery, "ON CONFLICT (user_id) DO UPDATE")
}

func TestApplyBestScoreWithALowerRetryDoesNotChangeThePoints(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id, quiz := mustUUID(t, testUserID), mustUUID(t, testQuizID)

	// Primer intento: 90,00 puntos. La base acepta el puntaje y recalcula a 90.
	expectApplyBestScore(mock, id, quiz, decimal.RequireFromString("90.00"), 90)
	first, err := s.ApplyBestScore(context.Background(), id, quiz, decimal.RequireFromString("90.00"))
	require.NoError(t, err)
	require.Equal(t, int32(90), first.Points)

	// Reintento con 40,00: el `WHERE EXCLUDED.best_score > ...` no se cumple, el
	// UPSERT no afecta ninguna fila y NO falla — el recálculo vuelve a dar 90.
	//
	// Este es el caso que FR-014 exige y el que hace innecesaria una compensación
	// destructiva en la saga de calificación: reintentar nunca puede bajarle los
	// puntos a nadie, así que el paso se puede repetir sin consecuencias.
	expectApplyBestScore(mock, id, quiz, decimal.RequireFromString("40.00"), 90)
	second, err := s.ApplyBestScore(context.Background(), id, quiz, decimal.RequireFromString("40.00"))
	require.NoError(t, err)
	require.Equal(t, int32(90), second.Points)
}

func TestApplyBestScoreRollsBackWhenTheRecomputeFails(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id, quiz := mustUUID(t, testUserID), mustUUID(t, testQuizID)
	score := decimal.RequireFromString("75.00")

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO progress").WithArgs(id).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO quiz_best_score").WithArgs(id, quiz, score).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("UPDATE progress").WithArgs(id).
		WillReturnError(errors.New("conexión perdida"))
	mock.ExpectRollback()

	_, err := s.ApplyBestScore(context.Background(), id, quiz, score)
	require.Error(t, err)

	// La reversión es lo que mantiene idempotente la operación: si el mejor puntaje
	// quedara guardado y los puntos no, el reintento vería el puntaje ya almacenado,
	// decidiría que no mejora y jamás volvería a sumarlo. El usuario perdería
	// progreso de forma permanente e invisible.
}

func TestApplyBestScoreTranslatesMissingProfile(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id, quiz := mustUUID(t, testUserID), mustUUID(t, testQuizID)

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO progress").WithArgs(id).
		WillReturnError(pgErr(pgForeignKeyViolation))
	mock.ExpectRollback()

	// Toda clave ajena del esquema apunta a `profiles`, así que violarla significa
	// exactamente una cosa: el usuario no existe.
	_, err := s.ApplyBestScore(context.Background(), id, quiz, decimal.RequireFromString("10.00"))
	require.ErrorIs(t, err, ErrNotFound)
}

func TestGetProgressTranslatesNoRows(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	mock.ExpectQuery("FROM progress WHERE user_id").WithArgs(id).
		WillReturnRows(sqlmock.NewRows([]string{}))

	_, err := s.GetProgress(context.Background(), id)
	require.ErrorIs(t, err, ErrNotFound)
}

// ── historial de lecturas (FR-015) ──────────────────────────────────────────

func TestRecordArticleViewKeepsTheFirstViewTimestamp(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id, article := mustUUID(t, testUserID), mustUUID(t, testArticleID)

	mock.ExpectExec("INSERT INTO article_views").WithArgs(id, article).
		WillReturnResult(sqlmock.NewResult(0, 1))

	require.NoError(t, s.RecordArticleView(context.Background(), id, article))

	// `first_viewed_at` no aparece en el DO UPDATE: es el dato que distingue cuándo
	// descubrió el artículo de cuándo lo releyó, y refrescarlo dejaría las dos
	// columnas diciendo lo mismo.
	require.NotContains(t, recordArticleViewQuery, "first_viewed_at = ")
	require.Contains(t, recordArticleViewQuery, "view_count = article_views.view_count + 1")
}

func TestCountArticleViewsCountsDistinctArticles(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	mock.ExpectQuery("SELECT COUNT").WithArgs(id).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(7)))

	n, err := s.CountArticleViews(context.Background(), id)
	require.NoError(t, err)
	// La PK es `(user_id, article_id)`, así que contar filas ya cuenta artículos
	// distintos: releer el mismo artículo sube `view_count`, no el número de filas.
	require.Equal(t, int64(7), n)
}

// ── bandeja in-app (FR-023, plan.md N-03) ───────────────────────────────────

func TestAppendInAppNotificationAbsorbsRedelivery(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id, notif := mustUUID(t, testUserID), mustUUID(t, testNotifID)

	mock.ExpectExec("INSERT INTO inapp_notifications").
		WithArgs(notif, id, "hito_progreso", []byte(`{"points":90}`)).
		WillReturnResult(sqlmock.NewResult(0, 0)) // 0 filas: ya estaba

	row := InAppNotificationRow{
		ID: notif, UserID: id, Type: "hito_progreso", Payload: []byte(`{"points":90}`),
	}
	// Cero filas afectadas NO es un error: el identificador lo deriva `server` del
	// contenido, así que una reentrega trae el mismo `id` y el `DO NOTHING` la
	// absorbe. Tratarlo como fallo haría que la saga reintentara para siempre.
	require.NoError(t, s.AppendInAppNotification(context.Background(), row))
	require.Contains(t, appendInAppQuery, "ON CONFLICT (id) DO NOTHING")
}

func TestListInAppNotificationsPaginatesStably(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)
	created := time.Now().UTC()

	mock.ExpectQuery("FROM inapp_notifications").WithArgs(id, int32(2), int32(0)).
		WillReturnRows(sqlmock.NewRows(
			[]string{"id", "user_id", "type", "payload", "read_state", "created_at", "read_at"}).
			AddRow(testNotifID, testUserID, "hito_progreso", []byte(`{}`), "unread", created, nil))
	mock.ExpectQuery("SELECT COUNT").WithArgs(id).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(5)))

	rows, total, err := s.ListInAppNotifications(context.Background(), id, 2, 0)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, int64(5), total)
	require.Nil(t, rows[0].ReadAt)

	// El desempate por `id` evita que dos notificaciones escritas en la misma
	// transacción —y por tanto con el mismo `created_at`— se repartan entre páginas
	// consecutivas repitiendo una y saltándose la otra.
	require.Contains(t, listInAppQuery, "ORDER BY created_at DESC, id DESC")
}

func TestMarkNotificationReadIsScopedToTheOwner(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id, notif := mustUUID(t, testUserID), mustUUID(t, testNotifID)

	mock.ExpectQuery("UPDATE inapp_notifications").WithArgs(id, notif).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(testNotifID))

	require.NoError(t, s.MarkNotificationRead(context.Background(), id, notif))

	// `user_id` en el WHERE es lo único que impide marcar como leída la
	// notificación de otro usuario conociendo su identificador. Tiene que estar en
	// la consulta y no en una comprobación en Go, donde un camino futuro podría
	// saltársela.
	require.Contains(t, markNotificationReadQuery, "WHERE id = $2 AND user_id = $1")
	// `COALESCE` conserva la marca original: sin él, una segunda llamada reescribiría
	// la hora y el usuario vería que «leyó» algo cuando no estaba delante.
	require.Contains(t, markNotificationReadQuery, "read_at = COALESCE(read_at, now())")
}

func TestMarkNotificationReadHidesForeignNotifications(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id, notif := mustUUID(t, testUserID), mustUUID(t, testNotifID)

	mock.ExpectQuery("UPDATE inapp_notifications").WithArgs(id, notif).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	// «No existe» y «existe pero es de otro» salen indistinguibles a propósito: un
	// error distinto para el segundo caso confirmaría la existencia de la
	// notificación ajena.
	require.ErrorIs(t, s.MarkNotificationRead(context.Background(), id, notif), ErrNotFound)
}
