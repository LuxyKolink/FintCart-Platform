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

// ── dobles de los puertos salientes (plan.md N-02) ──────────────────────────

type fakeCounter struct{ n int64 }

func (f fakeCounter) CountAttempts(context.Context, string) (int64, error)    { return f.n, nil }
func (f fakeCounter) CountSimulations(context.Context, string) (int64, error) { return f.n, nil }

// ── arranque de la pila real ────────────────────────────────────────────────

// startServer levanta el servidor gRPC completo sobre `bufconn` y devuelve el
// cliente GENERADO.
//
// Se usa el cliente generado y no una llamada directa al handler porque solo así
// se ejercita la serialización protobuf: un campo renombrado en el `.proto` rompe
// aquí, que es exactamente el fallo que estas pruebas existen para atrapar.
func startServer(t *testing.T, store storer.Storer) usersv1.UsersServiceClient {
	t.Helper()

	svc := server.New(store, fakeCounter{}, fakeCounter{})
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

func TestAppendInAppNotificationContract(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServer(t, store)

	resp, err := client.AppendInAppNotification(context.Background(), &usersv1.InAppNotification{
		UserId: testUserID, Type: "hito_progreso", PayloadJson: `{"points":90}`,
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
		UserId: testUserID, Type: "resultado_cuestionario", PayloadJson: `{"quiz":"a","score":"90.00"}`,
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

func TestAppendInAppNotificationIgnoresPayloadKeyOrder(t *testing.T) {
	t.Parallel()
	store := newFakeStore()
	client := startServer(t, store)

	for _, payload := range []string{`{"a":1,"b":2}`, `{"b":2,"a":1}`} {
		_, err := client.AppendInAppNotification(context.Background(), &usersv1.InAppNotification{
			UserId: testUserID, Type: "recordatorio", PayloadJson: payload,
		})
		require.NoError(t, err)
	}

	// El mismo documento con las claves en otro orden es el mismo evento. Sin
	// reserializar antes de derivar el identificador, la deduplicación dependería de
	// que el emisor serializara siempre igual — algo que ningún contrato garantiza.
	require.Len(t, store.appended, 1)

	// Y lo almacenado sigue siendo el documento íntegro, no una cadena arbitraria ni
	// una versión recortada por la canonicalización.
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
		"tipo desconocido": {UserId: testUserID, Type: "sms", PayloadJson: "{}"},
		"tipo vacío":       {UserId: testUserID, Type: "", PayloadJson: "{}"},
		"payload roto":     {UserId: testUserID, Type: "recordatorio", PayloadJson: "{no es json"},
		// `JSONB` aceptaría un escalar, pero el frontend lee el payload por clave y
		// un `5` produciría una tarjeta vacía sin que nada fallara.
		"payload escalar":  {UserId: testUserID, Type: "recordatorio", PayloadJson: "5"},
		"usuario inválido": {UserId: "yo", Type: "recordatorio", PayloadJson: "{}"},
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
