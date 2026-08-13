// Pruebas de CONTRATO de `UsersService` (T070): productor ↔ consumidor.
//
// Qué son y por qué van aquí. Atraviesan la pila real de transporte —un servidor
// gRPC de verdad sobre `bufconn`, con el cliente GENERADO desde `contracts/proto`—
// y sustituyen únicamente lo que hay por debajo de la capa de aplicación: la
// persistencia y los dos puertos salientes. Comprueban por tanto justo lo que un
// test de unidad no puede: que los campos del `.proto` llegan donde deben, que los
// errores de dominio salen con el código de estado correcto, y que un cambio en
// `contracts/` rompe aquí en lugar de en producción.
//
// `bufconn` en lugar de un puerto TCP: la conexión vive en memoria, así que no hay
// puertos que reservar ni carreras entre pruebas paralelas.
//
// El paquete es `server_test` (externo) a propósito: si fuera `server`, importar
// `handler` —que importa `server`— sería un ciclo.
package server_test

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	usersv1 "github.com/fintcart/platform/services/users/gen/fintcart/users/v1"
	"github.com/fintcart/platform/services/users/internal/handler"
	"github.com/fintcart/platform/services/users/internal/server"
	"github.com/fintcart/platform/services/users/internal/storer"
)

const (
	testUserID    = "3f0f8b2e-2c53-4a2c-9f0a-1d2e3f4a5b6c"
	testQuizID    = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
	testArticleID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f"
	testEmail     = "ana@fintcart.co"
	testName      = "Ana Restrepo"
)

// ── doble de la persistencia ────────────────────────────────────────────────
//
// Es un doble a mano y no generado: embebe `storer.Storer`, así que solo hace
// falta escribir los métodos que la prueba ejercita y cualquier otro que se
// invoque por error revienta con un nil pointer en vez de devolver un cero
// silencioso que parezca un dato válido.

type fakeStore struct {
	storer.Storer

	profile      storer.ProfileRow
	profileErr   error
	roles        []storer.RoleRow
	progress     storer.ProgressRow
	progressErr  error
	createdRole  string
	createdRow   storer.ProfileRow
	verifyErr    error
	appliedScore decimal.Decimal
	views        []uuid.UUID
	// appended acumula las notificaciones por identificador DERIVADO, igual que
	// hace el `ON CONFLICT (id) DO NOTHING` de la tabla. Un slice no serviría: la
	// deduplicación es precisamente lo que se quiere observar.
	appended map[uuid.UUID]storer.InAppNotificationRow

	prefs          storer.PreferencesRow
	prefsErr       error
	upsertedPrefs  *storer.PreferencesRow
	updatedName    *string
	updateNameErr  error
	articleViews   int64
	articleViewErr error
	inappItems     []storer.InAppNotificationRow
	inappTotal     int64
	inappErr       error
	markedRead     []struct{ userID, notifID uuid.UUID }
	markReadErr    error
	anonymizedID   uuid.UUID
	anonymizedMail string
	anonymizedName string
	anonymizeErr   error
}

func newFakeStore() *fakeStore {
	return &fakeStore{appended: map[uuid.UUID]storer.InAppNotificationRow{}}
}

func (f *fakeStore) CreateProfile(_ context.Context, p storer.ProfileRow, role string) error {
	if f.profileErr != nil {
		return f.profileErr
	}
	f.createdRow, f.createdRole = p, role
	return nil
}

func (f *fakeStore) MarkEmailVerified(context.Context, uuid.UUID) error { return f.verifyErr }

func (f *fakeStore) GetProfile(context.Context, uuid.UUID) (storer.ProfileRow, error) {
	return f.profile, f.profileErr
}

func (f *fakeStore) GetRoles(context.Context, uuid.UUID) ([]storer.RoleRow, error) {
	return f.roles, nil
}

func (f *fakeStore) ApplyBestScore(
	_ context.Context, _, _ uuid.UUID, score decimal.Decimal,
) (storer.ProgressRow, error) {
	f.appliedScore = score
	return f.progress, f.progressErr
}

func (f *fakeStore) GetProgress(context.Context, uuid.UUID) (storer.ProgressRow, error) {
	return f.progress, f.progressErr
}

func (f *fakeStore) RecordArticleView(_ context.Context, _, articleID uuid.UUID) error {
	f.views = append(f.views, articleID)
	return nil
}

func (f *fakeStore) AppendInAppNotification(_ context.Context, n storer.InAppNotificationRow) error {
	if _, dup := f.appended[n.ID]; dup {
		return nil // el DO NOTHING de la tabla
	}
	f.appended[n.ID] = n
	return nil
}

func (f *fakeStore) GetPreferences(context.Context, uuid.UUID) (storer.PreferencesRow, error) {
	return f.prefs, nil
}

func (f *fakeStore) UpsertPreferences(_ context.Context, p storer.PreferencesRow) error {
	f.upsertedPrefs = &p
	return nil
}

func (f *fakeStore) UpdateDisplayName(_ context.Context, _ uuid.UUID, name string) error {
	if f.updateNameErr != nil {
		return f.updateNameErr
	}
	f.updatedName = &name
	return nil
}

func (f *fakeStore) CountArticleViews(context.Context, uuid.UUID) (int64, error) {
	return f.articleViews, f.articleViewErr
}

func (f *fakeStore) ListInAppNotifications(
	context.Context, uuid.UUID, int32, int32,
) ([]storer.InAppNotificationRow, int64, error) {
	return f.inappItems, f.inappTotal, f.inappErr
}

func (f *fakeStore) MarkNotificationRead(_ context.Context, userID, notifID uuid.UUID) error {
	if f.markReadErr != nil {
		return f.markReadErr
	}
	f.markedRead = append(f.markedRead, struct{ userID, notifID uuid.UUID }{userID, notifID})
	return nil
}

func (f *fakeStore) AnonymizeProfile(_ context.Context, userID uuid.UUID, opaqueEmail, opaqueName string) error {
	if f.anonymizeErr != nil {
		return f.anonymizeErr
	}
	f.anonymizedID, f.anonymizedMail, f.anonymizedName = userID, opaqueEmail, opaqueName
	return nil
}

// ── dobles de los puertos salientes (plan.md N-02) ──────────────────────────

type fakeCounter struct{ n int64 }

func (f fakeCounter) CountAttempts(context.Context, string) (int64, error)    { return f.n, nil }
func (f fakeCounter) CountSimulations(context.Context, string) (int64, error) { return f.n, nil }

// fakeFailingCounter reproduce un participante remoto caído, para comprobar
// que `GetActivityReport` no sustituye el contador ausente por cero.
type fakeFailingCounter struct{ err error }

func (f fakeFailingCounter) CountAttempts(context.Context, string) (int64, error) {
	return 0, f.err
}

func (f fakeFailingCounter) CountSimulations(context.Context, string) (int64, error) {
	return 0, f.err
}

// ── arranque de la pila real ────────────────────────────────────────────────

// startServer levanta el servidor gRPC completo sobre `bufconn` y devuelve el
// cliente GENERADO.
//
// Se usa el cliente generado y no una llamada directa al handler porque solo así
// se ejercita la serialización protobuf: un campo renombrado en el `.proto` rompe
// aquí, que es exactamente el fallo que estas pruebas existen para atrapar.
func startServer(t *testing.T, store storer.Storer) usersv1.UsersServiceClient {
	t.Helper()
	return startServerWith(t, store, fakeCounter{}, fakeCounter{})
}

// startServerWith es la variante para las pruebas de `GetActivityReport`, que
// necesitan controlar por separado lo que devuelve (o falla) cada puerto
// saliente — algo que un `fakeCounter{}` compartido no permite distinguir.
func startServerWith(
	t *testing.T,
	store storer.Storer,
	attempts server.AttemptCounter,
	sims server.SimulationCounter,
) usersv1.UsersServiceClient {
	t.Helper()

	svc := server.New(store, attempts, sims)
	grpcServer := grpc.NewServer()
	handler.New(svc).Register(grpcServer)

	lis := bufconn.Listen(1024 * 1024)
	go func() { _ = grpcServer.Serve(lis) }()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)

	t.Cleanup(func() {
		_ = conn.Close()
		grpcServer.Stop()
		_ = lis.Close()
	})

	return usersv1.NewUsersServiceClient(conn)
}

// requireCode afirma que el error gRPC lleva el código esperado.
func requireCode(t *testing.T, err error, want codes.Code) {
	t.Helper()
	require.Error(t, err)
	require.Equal(t, want, status.Code(err), "error recibido: %v", err)
}

// ── CreateProfile (FR-001) ──────────────────────────────────────────────────

func TestCreateProfileContract(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServer(t, store)

	resp, err := client.CreateProfile(context.Background(), &usersv1.CreateProfileRequest{
		UserId: testUserID, Email: "  " + testEmail + "  ", DisplayName: "  " + testName + "  ",
	})
	require.NoError(t, err)
	require.True(t, resp.GetSuccess())

	// Los espacios de los extremos se recortan ANTES de llegar a la persistencia: un
	// correo con un espacio delante es un correo distinto para el índice único, y la
	// misma persona podría registrarse dos veces.
	require.Equal(t, testEmail, store.createdRow.Email)
	require.Equal(t, testName, store.createdRow.DisplayName)

	// El rol inicial lo fija el servicio y NO viaja en la petición. Si entrara por
	// el contrato, cualquiera que pudiera invocar este RPC interno podría crear un
	// coordinador editorial.
	require.Equal(t, "usuario_final", store.createdRole)
}

func TestCreateProfileRejectsMalformedInput(t *testing.T) {
	t.Parallel()

	cases := map[string]*usersv1.CreateProfileRequest{
		"user_id que no es UUID": {UserId: "no-soy-un-uuid", Email: testEmail, DisplayName: testName},
		"correo sin arroba":      {UserId: testUserID, Email: "ana-arroba-fintcart", DisplayName: testName},
		"correo vacío":           {UserId: testUserID, Email: "", DisplayName: testName},
		// `mail.ParseAddress` acepta la forma con nombre; guardarla en la columna
		// dejaría un «correo» al que no se puede escribir, así que se exige que la
		// cadena sea EXACTAMENTE la dirección.
		"correo con nombre visible": {UserId: testUserID, Email: "Ana <ana@fintcart.co>", DisplayName: testName},
		"nombre vacío":              {UserId: testUserID, Email: testEmail, DisplayName: "   "},
		"nombre desmesurado":        {UserId: testUserID, Email: testEmail, DisplayName: strings.Repeat("a", 121)},
	}

	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			client := startServer(t, newFakeStore())

			_, err := client.CreateProfile(context.Background(), req)
			requireCode(t, err, codes.InvalidArgument)
		})
	}
}

func TestCreateProfileReportsDuplicateEmailAsConflict(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.profileErr = storer.ErrConflict
	client := startServer(t, store)

	_, err := client.CreateProfile(context.Background(), &usersv1.CreateProfileRequest{
		UserId: testUserID, Email: testEmail, DisplayName: testName,
	})

	// El correo ya registrado no es un error interno: el cliente puede y debe
	// distinguirlo para pedirle otro al usuario (FR-001).
	requireCode(t, err, codes.FailedPrecondition)
}

// ── MarkEmailVerified (FR-002) ──────────────────────────────────────────────

func TestMarkEmailVerifiedContract(t *testing.T) {
	t.Parallel()
	client := startServer(t, newFakeStore())

	resp, err := client.MarkEmailVerified(context.Background(),
		&usersv1.UserRef{UserId: testUserID})
	require.NoError(t, err)
	require.True(t, resp.GetSuccess())
}

func TestMarkEmailVerifiedOnMissingProfile(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.verifyErr = storer.ErrNotFound
	client := startServer(t, store)

	_, err := client.MarkEmailVerified(context.Background(),
		&usersv1.UserRef{UserId: testUserID})
	requireCode(t, err, codes.NotFound)
}

// ── GetAuthContext (D-04) ───────────────────────────────────────────────────

func TestGetAuthContextReturnsRolesAndVerificationState(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.profile = storer.ProfileRow{
		ID:            uuid.MustParse(testUserID),
		Email:         testEmail,
		DisplayName:   testName,
		EmailVerified: true,
		AccountStatus: "active",
	}
	store.roles = []storer.RoleRow{{Role: "editor"}, {Role: "usuario_final"}}
	client := startServer(t, store)

	got, err := client.GetAuthContext(context.Background(), &usersv1.UserRef{UserId: testUserID})
	require.NoError(t, err)

	require.Equal(t, testUserID, got.GetUserId())
	require.Equal(t, []string{"editor", "usuario_final"}, got.GetRoles())
	require.Equal(t, "active", got.GetAccountStatus())
	require.True(t, got.GetEmailVerified())
}

func TestGetAuthContextNeverLeaksPersonalData(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.profile = storer.ProfileRow{
		ID:            uuid.MustParse(testUserID),
		Email:         testEmail,
		DisplayName:   testName,
		AccountStatus: "active",
	}
	client := startServer(t, store)

	got, err := client.GetAuthContext(context.Background(), &usersv1.UserRef{UserId: testUserID})
	require.NoError(t, err)

	// Esta es la prueba importante del RPC. Lo que sale de aquí acaba dentro de un
	// JWT firmado que viaja en cada petición y que nadie puede revocar antes de que
	// expire: un correo o un nombre que se cuelen quedan expuestos a cualquiera que
	// intercepte el token. Se comprueba sobre el mensaje SERIALIZADO para que un
	// campo añadido por descuido en el futuro aparezca aquí aunque nadie actualice
	// la aserción.
	serialized := got.String()
	require.NotContains(t, serialized, testEmail)
	require.NotContains(t, serialized, testName)
}

func TestGetAuthContextOnMissingProfile(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.profileErr = storer.ErrNotFound
	client := startServer(t, store)

	_, err := client.GetAuthContext(context.Background(), &usersv1.UserRef{UserId: testUserID})
	requireCode(t, err, codes.NotFound)
}

// ── ApplyQuizScore (FR-014, D-07, Principio VIII) ───────────────────────────

func TestApplyQuizScoreCrossesTheBorderAsExactDecimal(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.progress = storer.ProgressRow{UserID: uuid.MustParse(testUserID), Points: 175}
	client := startServer(t, store)

	got, err := client.ApplyQuizScore(context.Background(), &usersv1.ApplyQuizScoreRequest{
		UserId: testUserID, QuizId: testQuizID, Score: "85.55",
	})
	require.NoError(t, err)
	require.Equal(t, int32(175), got.GetPoints())

	// 85.55 no tiene representación exacta en binario: si el puntaje pasara por un
	// `float64` en cualquier punto del camino, lo que llegaría a la persistencia
	// sería 85.549999999999997 y la comparación con el mejor histórico —de la que
	// depende la monotonía de D-07— dejaría de ser fiable.
	require.True(t, store.appliedScore.Equal(decimal.RequireFromString("85.55")),
		"el puntaje llegó como %s", store.appliedScore)
}

func TestApplyQuizScoreRejectsNonCanonicalDecimals(t *testing.T) {
	t.Parallel()

	// El tipo lógico `DecimalString` (D-10) es `^-?\d+(\.\d+)?$` y nada más. Se
	// rechaza en vez de normalizar: si dos servicios discrepan en el formato de un
	// número, queremos un error en la frontera y no un valor silenciosamente
	// distinto en la base.
	for _, score := range []string{
		"8.555e1",  // notación científica
		"85,55",    // separador decimal local
		"+85.55",   // signo positivo explícito
		".55",      // falta la parte entera
		" 85.55",   // espacios
		"85.555",   // más decimales de los que admite NUMERIC(6,2)
		"12345.00", // no cabe en NUMERIC(6,2)
		"",         // vacío
	} {
		t.Run(score, func(t *testing.T) {
			t.Parallel()
			client := startServer(t, newFakeStore())

			_, err := client.ApplyQuizScore(context.Background(), &usersv1.ApplyQuizScoreRequest{
				UserId: testUserID, QuizId: testQuizID, Score: score,
			})
			requireCode(t, err, codes.InvalidArgument)
		})
	}
}

func TestApplyQuizScoreRejectsMalformedQuizID(t *testing.T) {
	t.Parallel()
	client := startServer(t, newFakeStore())

	_, err := client.ApplyQuizScore(context.Background(), &usersv1.ApplyQuizScoreRequest{
		UserId: testUserID, QuizId: "el-cuestionario", Score: "10.00",
	})
	requireCode(t, err, codes.InvalidArgument)
}

// ── GetProgress y RecordArticleView (FR-014, FR-015) ────────────────────────

func TestGetProgressContract(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.progress = storer.ProgressRow{UserID: uuid.MustParse(testUserID), Points: 42}
	client := startServer(t, store)

	got, err := client.GetProgress(context.Background(), &usersv1.UserRef{UserId: testUserID})
	require.NoError(t, err)
	require.Equal(t, testUserID, got.GetUserId())
	require.Equal(t, int32(42), got.GetPoints())
}

func TestRecordArticleViewContract(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServer(t, store)

	resp, err := client.RecordArticleView(context.Background(), &usersv1.RecordArticleViewRequest{
		UserId: testUserID, ArticleId: testArticleID,
	})
	require.NoError(t, err)
	require.True(t, resp.GetSuccess())
	require.Equal(t, []uuid.UUID{uuid.MustParse(testArticleID)}, store.views)
}

func TestRecordArticleViewRejectsMalformedArticleID(t *testing.T) {
	t.Parallel()
	client := startServer(t, newFakeStore())

	_, err := client.RecordArticleView(context.Background(), &usersv1.RecordArticleViewRequest{
		UserId: testUserID, ArticleId: "el-articulo",
	})
	requireCode(t, err, codes.InvalidArgument)
}

// ── AppendInAppNotification (FR-023, plan.md N-03) ──────────────────────────

// testEventID y testEventID2 son `event_id` de saga: la clave de idempotencia con la
// que la bandeja distingue una reentrega de una notificación nueva.
const (
	testEventID  = "b1a7c9d0-4e2f-4a1b-8c3d-5e6f70819234"
	testEventID2 = "c2b8dae1-5f30-4b2c-9d4e-6f7081920345"
)

func TestAppendInAppNotificationContract(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServer(t, store)

	resp, err := client.AppendInAppNotification(context.Background(), &usersv1.InAppNotification{
		UserId: testUserID, Type: "hito_progreso", PayloadJson: `{"points":90}`, EventId: testEventID,
	})
	require.NoError(t, err)
	require.True(t, resp.GetSuccess())
	require.Len(t, store.appended, 1)
}

func TestAppendInAppNotificationIsIdempotentUnderRedelivery(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServer(t, store)

	req := &usersv1.InAppNotification{
		UserId: testUserID, Type: "resultado_cuestionario",
		PayloadJson: `{"quiz":"a","score":"90.00"}`, EventId: testEventID,
	}
	for range 3 {
		_, err := client.AppendInAppNotification(context.Background(), req)
		require.NoError(t, err)
	}

	// La saga entrega at-least-once (D-07), así que la reentrega es lo normal y no
	// la excepción. Con un identificador aleatorio, el usuario vería tres copias de
	// la misma notificación en su bandeja y nada permitiría distinguir cuál sobra.
	require.Len(t, store.appended, 1)
}

// TestAppendInAppNotificationKeepsIdenticalNotificationsOfDifferentEvents es la
// prueba de por qué la identidad NO puede deducirse del contenido.
//
// Dos hitos idénticos alcanzados en dos momentos distintos producen exactamente los
// mismos bytes. Con el identificador derivado del payload —como estaba antes de que
// el contrato tuviera `event_id`—, el segundo se tragaba al primero y el usuario
// perdía una notificación sin que nada lo delatara.
func TestAppendInAppNotificationKeepsIdenticalNotificationsOfDifferentEvents(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServer(t, store)

	for _, eventID := range []string{testEventID, testEventID2} {
		_, err := client.AppendInAppNotification(context.Background(), &usersv1.InAppNotification{
			UserId: testUserID, Type: "hito_progreso", PayloadJson: `{"points":100}`, EventId: eventID,
		})
		require.NoError(t, err)
	}
	require.Len(t, store.appended, 2)
}

// TestAppendInAppNotificationSeparatesTypesOfTheSameEvent: la saga de calificación
// produce el resultado del cuestionario y el hito de progreso a partir del MISMO
// evento. Si la identidad fuera el `event_id` a solas, la segunda notificación se
// consideraría una reentrega de la primera y no llegaría nunca.
func TestAppendInAppNotificationSeparatesTypesOfTheSameEvent(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServer(t, store)

	for _, notifType := range []string{"resultado_cuestionario", "hito_progreso"} {
		_, err := client.AppendInAppNotification(context.Background(), &usersv1.InAppNotification{
			UserId: testUserID, Type: notifType, PayloadJson: `{"score":"90.00"}`, EventId: testEventID,
		})
		require.NoError(t, err)
	}
	require.Len(t, store.appended, 2)
}

func TestAppendInAppNotificationStoresTheWholePayload(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServer(t, store)

	// Las claves llegan desordenadas: el payload se reserializa en forma canónica
	// para que el documento guardado sea estable, independientemente de cómo lo
	// serializara el emisor.
	_, err := client.AppendInAppNotification(context.Background(), &usersv1.InAppNotification{
		UserId: testUserID, Type: "recordatorio", PayloadJson: `{"b":2,"a":1}`, EventId: testEventID,
	})
	require.NoError(t, err)

	require.Len(t, store.appended, 1)
	for _, row := range store.appended {
		require.JSONEq(t, `{"a":1,"b":2}`, string(row.Payload))
	}
}

func TestAppendInAppNotificationRejectsInvalidInput(t *testing.T) {
	t.Parallel()

	cases := map[string]*usersv1.InAppNotification{
		// Los cuatro tipos válidos los fija el CHECK de la tabla; validarlos aquí es
		// lo que convierte un tipo mal escrito en «argumento inválido» y no en una
		// violación de constraint que la saga reintentaría para siempre.
		"tipo desconocido": {UserId: testUserID, Type: "sms", PayloadJson: "{}", EventId: testEventID},
		"tipo vacío":       {UserId: testUserID, Type: "", PayloadJson: "{}", EventId: testEventID},
		"payload roto": {
			UserId: testUserID, Type: "recordatorio", PayloadJson: "{no es json", EventId: testEventID,
		},
		// `JSONB` aceptaría un escalar, pero el frontend lee el payload por clave y
		// un `5` produciría una tarjeta vacía sin que nada fallara.
		"payload escalar":  {UserId: testUserID, Type: "recordatorio", PayloadJson: "5", EventId: testEventID},
		"usuario inválido": {UserId: "yo", Type: "recordatorio", PayloadJson: "{}", EventId: testEventID},
		// Sin `event_id` no hay clave de idempotencia. Se RECHAZA en lugar de recurrir
		// a una derivación de respaldo sobre el contenido: el productor que olvidara el
		// campo seguiría funcionando con una deduplicación peor y nadie se enteraría
		// hasta ver notificaciones desaparecidas.
		"event_id ausente": {UserId: testUserID, Type: "recordatorio", PayloadJson: "{}"},
		"event_id no UUID": {
			UserId: testUserID, Type: "recordatorio", PayloadJson: "{}", EventId: "evento-1",
		},
	}

	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			client := startServer(t, newFakeStore())

			_, err := client.AppendInAppNotification(context.Background(), req)
			requireCode(t, err, codes.InvalidArgument)
		})
	}
}

// ── Perfil y preferencias (FR-017, FR-029, T129) ────────────────────────────

func TestGetProfileContract(t *testing.T) {
	t.Parallel()
	id := uuid.MustParse(testUserID)
	store := newFakeStore()
	store.profile = storer.ProfileRow{
		ID: id, Email: testEmail, DisplayName: testName,
		EmailVerified: true, AccountStatus: "active",
	}
	store.roles = []storer.RoleRow{{UserID: id, Role: "usuario_final"}}
	store.prefs = storer.PreferencesRow{
		UserID: id, Locale: "es-CO", NotifInApp: true, NotifEmail: false,
	}
	client := startServer(t, store)

	resp, err := client.GetProfile(context.Background(), &usersv1.UserRef{UserId: testUserID})
	require.NoError(t, err)
	require.Equal(t, testEmail, resp.GetEmail())
	require.Equal(t, testName, resp.GetDisplayName())
	require.True(t, resp.GetEmailVerified())
	require.Equal(t, "active", resp.GetAccountStatus())
	require.Equal(t, []string{"usuario_final"}, resp.GetRoles())
	require.Equal(t, "es-CO", resp.GetPreferences()["locale"])
	require.Equal(t, "true", resp.GetPreferences()["notif_inapp"])
	require.Equal(t, "false", resp.GetPreferences()["notif_email"])
}

func TestGetProfileOnMissingProfile(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.profileErr = storer.ErrNotFound
	client := startServer(t, store)

	_, err := client.GetProfile(context.Background(), &usersv1.UserRef{UserId: testUserID})
	requireCode(t, err, codes.NotFound)
}

func TestUpdateProfileChangesNameAndMergesPreferences(t *testing.T) {
	t.Parallel()
	id := uuid.MustParse(testUserID)
	store := newFakeStore()
	// Preferencias ACTUALES con `notif_email = true`: la prueba comprueba que
	// sobrevive intacta cuando la petición solo trae `locale`.
	store.prefs = storer.PreferencesRow{UserID: id, Locale: "es-CO", NotifInApp: true, NotifEmail: true}
	client := startServer(t, store)

	_, err := client.UpdateProfile(context.Background(), &usersv1.UpdateProfileRequest{
		UserId:      testUserID,
		DisplayName: "Ana Nueva",
		Preferences: map[string]string{"locale": "en-US"},
	})
	require.NoError(t, err)

	require.NotNil(t, store.updatedName)
	require.Equal(t, "Ana Nueva", *store.updatedName)
	require.NotNil(t, store.upsertedPrefs)
	require.Equal(t, "en-US", store.upsertedPrefs.Locale)
	require.True(t, store.upsertedPrefs.NotifEmail, "una preferencia no mencionada no debe apagarse")
}

// TestUpdateProfileWithoutDisplayNameLeavesItUntouched es el motivo de que el
// campo vacío signifique «no cambies esto» y no «bórralo» (ver el comentario
// de `UpdateProfile` en profile.go).
func TestUpdateProfileWithoutDisplayNameLeavesItUntouched(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.prefs = storer.PreferencesRow{UserID: uuid.MustParse(testUserID)}
	client := startServer(t, store)

	_, err := client.UpdateProfile(context.Background(), &usersv1.UpdateProfileRequest{
		UserId:      testUserID,
		Preferences: map[string]string{"locale": "en-US"},
	})
	require.NoError(t, err)
	require.Nil(t, store.updatedName)
}

func TestUpdateProfileRejectsAnInvalidPreferenceValue(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.prefs = storer.PreferencesRow{UserID: uuid.MustParse(testUserID)}
	client := startServer(t, store)

	_, err := client.UpdateProfile(context.Background(), &usersv1.UpdateProfileRequest{
		UserId:      testUserID,
		Preferences: map[string]string{"notif_email": "tal-vez"},
	})
	requireCode(t, err, codes.InvalidArgument)
}

// ── Bandeja in-app: lectura (FR-023, T129) ──────────────────────────────────

func TestListInAppNotificationsContract(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.inappItems = []storer.InAppNotificationRow{
		{ID: uuid.New(), Type: "hito_progreso", Payload: []byte(`{"puntos":100}`), ReadState: "unread"},
	}
	store.inappTotal = 1
	client := startServer(t, store)

	resp, err := client.ListInAppNotifications(context.Background(), &usersv1.ListInAppRequest{
		UserId: testUserID,
	})
	require.NoError(t, err)
	require.Len(t, resp.GetItems(), 1)
	require.Equal(t, "hito_progreso", resp.GetItems()[0].GetType())
	require.Equal(t, int64(1), resp.GetPage().GetTotalSize())
}

func TestMarkNotificationReadContract(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServer(t, store)
	notifID := uuid.New()

	_, err := client.MarkNotificationRead(context.Background(), &usersv1.MarkReadRequest{
		UserId: testUserID, NotificationId: notifID.String(),
	})
	require.NoError(t, err)
	require.Len(t, store.markedRead, 1)
	require.Equal(t, uuid.MustParse(testUserID), store.markedRead[0].userID)
	require.Equal(t, notifID, store.markedRead[0].notifID)
}

func TestMarkNotificationReadRejectsAMalformedNotificationID(t *testing.T) {
	t.Parallel()
	client := startServer(t, newFakeStore())

	_, err := client.MarkNotificationRead(context.Background(), &usersv1.MarkReadRequest{
		UserId: testUserID, NotificationId: "no-es-un-uuid",
	})
	requireCode(t, err, codes.InvalidArgument)
}

// ── Reporte de actividad (FR-018, plan.md N-02, T129) ───────────────────────

func TestGetActivityReportCombinesOwnAndRemoteCounts(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	store.progress = storer.ProgressRow{UserID: uuid.MustParse(testUserID), Points: 120}
	store.articleViews = 4
	client := startServerWith(t, store, fakeCounter{n: 3}, fakeCounter{n: 2})

	resp, err := client.GetActivityReport(context.Background(), &usersv1.UserRef{UserId: testUserID})
	require.NoError(t, err)
	require.Equal(t, int32(120), resp.GetPoints())
	require.Equal(t, int64(4), resp.GetArticlesViewed())
	require.Equal(t, int64(3), resp.GetQuizzesAttempted())
	require.Equal(t, int64(2), resp.GetSimulationsRun())
}

// TestGetActivityReportFailsWholeWhenARemoteParticipantFails es la prueba de
// que un contador ausente NUNCA se sustituye por cero: un reporte que dijera
// «cero simulaciones» cuando el Simulador simplemente no respondió sería un
// dato falso.
func TestGetActivityReportFailsWholeWhenARemoteParticipantFails(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServerWith(t, store, fakeCounter{}, fakeFailingCounter{err: errors.New("simulador caído")})

	_, err := client.GetActivityReport(context.Background(), &usersv1.UserRef{UserId: testUserID})
	requireCode(t, err, codes.Internal)
}

// ── Anonimización (FR-030, T129/T144) ───────────────────────────────────────

func TestAnonymizeProfileGeneratesAnOpaqueUniqueEmail(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServer(t, store)

	_, err := client.AnonymizeProfile(context.Background(), &usersv1.UserRef{UserId: testUserID})
	require.NoError(t, err)

	require.Equal(t, uuid.MustParse(testUserID), store.anonymizedID)
	// El correo opaco debe contener el user_id: es lo que lo mantiene único entre
	// cuentas anonimizadas sin necesitar una consulta extra (ver el comentario de
	// `server.AnonymizeProfile`).
	require.Contains(t, store.anonymizedMail, testUserID)
	require.NotEmpty(t, store.anonymizedName)
	require.NotContains(t, store.anonymizedMail, testEmail, "el correo opaco no debe filtrar el real")
}
