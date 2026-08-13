package handler_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	authv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/auth/v1"
	commonv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/common/v1"
	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
	simulatorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/simulator/v1"
	usersv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/users/v1"
	"github.com/fintcart/platform/services/api-gateway/internal/grpcclient"
	"github.com/fintcart/platform/services/api-gateway/internal/handler"
)

// Pruebas del BORDE completo: router + middlewares + handlers + mapeo, atacadas por
// HTTP con `httptest`.
//
// Están en el paquete `handler_test` (externo) a propósito: solo pueden usar lo que el
// paquete exporta, que es exactamente lo que ve `cmd/gateway/main.go`. Una prueba
// interna podría llamar a un handler saltándose el router, y entonces no comprobaría lo
// que más importa de este archivo —la POLÍTICA DE ACCESO—, que vive en el orden de los
// middlewares y no dentro de ningún handler.
//
// Los dobles de los clientes gRPC embeben la interfaz generada sin inicializarla: los
// métodos que una prueba no espera que se llamen provocan un panic inmediato. Es
// deliberado — una llamada inesperada a un servicio interno es un fallo del borde, y
// verlo como pánico ruidoso es mejor que como respuesta plausible.

// ── dobles ──────────────────────────────────────────────────────────────────

type fakeAuth struct {
	authv1.AuthServiceClient

	validate       func(*authv1.ValidateCredentialsRequest) (*authv1.ValidateCredentialsResponse, error)
	issue          func(*authv1.IssueAuthCodeRequest) (*authv1.IssueAuthCodeResponse, error)
	exchange       func(*authv1.ExchangeCodeRequest) (*authv1.TokenResponse, error)
	refresh        func(*authv1.RefreshTokenRequest) (*authv1.TokenResponse, error)
	revoked        []string
	lastChangePass *authv1.ChangePasswordRequest
	changePassErr  error
}

func (f *fakeAuth) ChangePassword(_ context.Context, in *authv1.ChangePasswordRequest, _ ...grpc.CallOption) (*commonv1.OpResult, error) {
	f.lastChangePass = in
	if f.changePassErr != nil {
		return nil, f.changePassErr
	}
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeAuth) ValidateCredentials(_ context.Context, in *authv1.ValidateCredentialsRequest, _ ...grpc.CallOption) (*authv1.ValidateCredentialsResponse, error) {
	return f.validate(in)
}

func (f *fakeAuth) IssueAuthorizationCode(_ context.Context, in *authv1.IssueAuthCodeRequest, _ ...grpc.CallOption) (*authv1.IssueAuthCodeResponse, error) {
	return f.issue(in)
}

func (f *fakeAuth) ExchangeCode(_ context.Context, in *authv1.ExchangeCodeRequest, _ ...grpc.CallOption) (*authv1.TokenResponse, error) {
	return f.exchange(in)
}

func (f *fakeAuth) RefreshToken(_ context.Context, in *authv1.RefreshTokenRequest, _ ...grpc.CallOption) (*authv1.TokenResponse, error) {
	return f.refresh(in)
}

func (f *fakeAuth) Revoke(_ context.Context, in *authv1.RevokeRequest, _ ...grpc.CallOption) (*commonv1.OpResult, error) {
	f.revoked = append(f.revoked, in.GetToken())
	return &commonv1.OpResult{Success: true}, nil
}

type fakeUsers struct {
	usersv1.UsersServiceClient

	lastUpdate *usersv1.UpdateProfileRequest
	lastMark   *usersv1.MarkReadRequest
	profile    *usersv1.Profile
	inbox      *usersv1.ListInAppResponse
}

func (f *fakeUsers) GetProfile(_ context.Context, in *usersv1.UserRef, _ ...grpc.CallOption) (*usersv1.Profile, error) {
	if f.profile == nil {
		return nil, status.Error(codes.NotFound, "sin perfil")
	}
	f.profile.UserId = in.GetUserId()
	return f.profile, nil
}

func (f *fakeUsers) UpdateProfile(_ context.Context, in *usersv1.UpdateProfileRequest, _ ...grpc.CallOption) (*commonv1.OpResult, error) {
	f.lastUpdate = in
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeUsers) GetProgress(_ context.Context, in *usersv1.UserRef, _ ...grpc.CallOption) (*usersv1.ProgressView, error) {
	return &usersv1.ProgressView{UserId: in.GetUserId(), Points: 120}, nil
}

func (f *fakeUsers) GetActivityReport(_ context.Context, in *usersv1.UserRef, _ ...grpc.CallOption) (*usersv1.ActivityReport, error) {
	return &usersv1.ActivityReport{
		UserId: in.GetUserId(), Points: 120, ArticlesViewed: 4, QuizzesAttempted: 3, SimulationsRun: 2,
	}, nil
}

func (f *fakeUsers) ListInAppNotifications(_ context.Context, _ *usersv1.ListInAppRequest, _ ...grpc.CallOption) (*usersv1.ListInAppResponse, error) {
	return f.inbox, nil
}

func (f *fakeUsers) MarkNotificationRead(_ context.Context, in *usersv1.MarkReadRequest, _ ...grpc.CallOption) (*commonv1.OpResult, error) {
	f.lastMark = in
	return &commonv1.OpResult{Success: true}, nil
}

type fakeLearning struct {
	learningv1.LearningServiceClient

	lastDraft   *learningv1.CreateDraftRequest
	lastPublish *learningv1.ApprovePublishRequest
	articles    *learningv1.ListPublishedResponse
	attempts    *learningv1.ListAttemptsResponse
}

func (f *fakeLearning) ListAttempts(_ context.Context, _ *learningv1.ListAttemptsRequest, _ ...grpc.CallOption) (*learningv1.ListAttemptsResponse, error) {
	if f.attempts == nil {
		return &learningv1.ListAttemptsResponse{}, nil
	}
	return f.attempts, nil
}

func (f *fakeLearning) CreateDraft(_ context.Context, in *learningv1.CreateDraftRequest, _ ...grpc.CallOption) (*learningv1.ArticleVersion, error) {
	f.lastDraft = in
	return &learningv1.ArticleVersion{VersionId: "v-1", ArticleId: "a-1", VersionNo: 1, State: "borrador", CreatedBy: in.GetEditorId()}, nil
}

func (f *fakeLearning) ApproveAndPublish(_ context.Context, in *learningv1.ApprovePublishRequest, _ ...grpc.CallOption) (*commonv1.OpResult, error) {
	f.lastPublish = in
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeLearning) ListPublished(_ context.Context, _ *learningv1.ListPublishedRequest, _ ...grpc.CallOption) (*learningv1.ListPublishedResponse, error) {
	return f.articles, nil
}

type fakeOrchestrator struct {
	orchestratorv1.OrchestratorServiceClient

	lastGrading    *orchestratorv1.QuizGradingRequest
	lastSimulation *orchestratorv1.SimulationRequest
	grading        *orchestratorv1.QuizGradingResult
	simulation     *orchestratorv1.SimulationResult
}

func (f *fakeOrchestrator) StartQuizGrading(_ context.Context, in *orchestratorv1.QuizGradingRequest, _ ...grpc.CallOption) (*orchestratorv1.QuizGradingResult, error) {
	f.lastGrading = in
	return f.grading, nil
}

func (f *fakeOrchestrator) StartSimulation(_ context.Context, in *orchestratorv1.SimulationRequest, _ ...grpc.CallOption) (*orchestratorv1.SimulationResult, error) {
	f.lastSimulation = in
	return f.simulation, nil
}

func (f *fakeOrchestrator) StartAccountAnonymization(_ context.Context, _ *orchestratorv1.UserRef, _ ...grpc.CallOption) (*orchestratorv1.SagaHandle, error) {
	return &orchestratorv1.SagaHandle{SagaId: "saga-1"}, nil
}

func (f *fakeOrchestrator) StartRegistration(_ context.Context, _ *orchestratorv1.StartRegistrationRequest, _ ...grpc.CallOption) (*orchestratorv1.SagaHandle, error) {
	return &orchestratorv1.SagaHandle{SagaId: "saga-registro"}, nil
}

func (f *fakeOrchestrator) StartEmailVerification(_ context.Context, _ *orchestratorv1.EmailVerificationRequest, _ ...grpc.CallOption) (*orchestratorv1.SagaHandle, error) {
	return &orchestratorv1.SagaHandle{SagaId: "saga-verificacion"}, nil
}

type fakeSimulator struct {
	simulatorv1.SimulatorServiceClient

	history *simulatorv1.ListHistoryResponse
}

func (f *fakeSimulator) ListHistory(_ context.Context, _ *simulatorv1.ListHistoryRequest, _ ...grpc.CallOption) (*simulatorv1.ListHistoryResponse, error) {
	return f.history, nil
}

// ── dobles de los puertos del borde ─────────────────────────────────────────

type fakeVerifier struct {
	claims handler.Claims
	err    error
}

func (f fakeVerifier) Verify(string) (handler.Claims, error) { return f.claims, f.err }

type fakeBlacklist struct {
	revoked bool
	err     error
}

func (f fakeBlacklist) IsBlacklisted(context.Context, string) (bool, error) {
	return f.revoked, f.err
}

type fakeLimiter struct {
	allowed bool
	err     error
	keys    []string
}

func (f *fakeLimiter) Allow(_ context.Context, key string) (handler.Decision, error) {
	f.keys = append(f.keys, key)
	if f.err != nil {
		return handler.Decision{}, f.err
	}
	return handler.Decision{Allowed: f.allowed, Remaining: 5, RetryAfter: 30 * time.Second}, nil
}

// ── andamiaje ───────────────────────────────────────────────────────────────

const testUserID = "11111111-1111-4111-8111-111111111111"

type harness struct {
	router       http.Handler
	auth         *fakeAuth
	users        *fakeUsers
	learning     *fakeLearning
	orchestrator *fakeOrchestrator
	simulator    *fakeSimulator
	limiter      *fakeLimiter
}

// newHarness monta el borde completo con un usuario final autenticado por defecto.
func newHarness(t *testing.T, opts ...func(*harness, *handler.Deps)) *harness {
	t.Helper()

	h := &harness{
		auth:         &fakeAuth{},
		users:        &fakeUsers{},
		learning:     &fakeLearning{},
		orchestrator: &fakeOrchestrator{},
		simulator:    &fakeSimulator{},
		limiter:      &fakeLimiter{allowed: true},
	}
	deps := handler.Deps{
		Verifier:    fakeVerifier{claims: handler.Claims{UserID: testUserID, JTI: "jti-1", Roles: []string{handler.RoleUsuarioFinal}}},
		Blacklist:   fakeBlacklist{},
		CORSOrigins: []string{"https://app.fintcart.co"},
	}
	for _, opt := range opts {
		opt(h, &deps)
	}
	deps.Limiter = h.limiter

	clients := &grpcclient.Clients{
		Auth:         h.auth,
		Users:        h.users,
		Learning:     h.learning,
		Simulator:    h.simulator,
		Orchestrator: h.orchestrator,
	}
	// Descarta los logs: lo que se comprueba es la respuesta, y una prueba que además
	// afirme sobre el texto del log se rompe al reescribir un mensaje.
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	h.router = handler.New(clients, logger).Routes(deps)
	return h
}

// withRoles reemplaza los roles del usuario autenticado.
func withRoles(roles ...string) func(*harness, *handler.Deps) {
	return func(_ *harness, d *handler.Deps) {
		d.Verifier = fakeVerifier{claims: handler.Claims{UserID: testUserID, JTI: "jti-1", Roles: roles}}
	}
}

func (h *harness) do(t *testing.T, method, target, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.Header.Set("Authorization", "Bearer token-de-prueba")
	}
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return out
}

// ── política de acceso ──────────────────────────────────────────────────────

// TestPublicRoutesNeedNoToken fija qué superficie es alcanzable SIN credenciales.
//
// Esta lista es una decisión de seguridad y por eso está escrita entera: si mañana
// alguien mueve una ruta al grupo público por comodidad, esta prueba no falla —tiene
// que actualizarla a mano—, y ese acto deliberado es justo el control que se busca.
func TestPublicRoutesNeedNoToken(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	for _, route := range []struct{ method, target string }{
		{http.MethodPost, "/oauth/authorize"},
		{http.MethodPost, "/oauth/token"},
		{http.MethodPost, "/auth/register"},
		{http.MethodPost, "/auth/verify-email"},
	} {
		rec := h.do(t, route.method, route.target, `{}`, false)
		require.NotEqual(t, http.StatusUnauthorized, rec.Code,
			"%s %s no debería exigir token", route.method, route.target)
	}
}

// TestProtectedRoutesRejectAnonymousRequests recorre TODA la superficie autenticada.
//
// Es la prueba que atrapa el fallo más caro posible del borde: una ruta registrada
// fuera del grupo que lleva `Authenticate` delante. Ese error no produce ningún
// síntoma —la ruta funciona— hasta que alguien la encuentra sin token.
func TestProtectedRoutesRejectAnonymousRequests(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	for _, route := range []struct{ method, target string }{
		{http.MethodPost, "/auth/logout"},
		{http.MethodGet, "/catalog/articles"},
		{http.MethodGet, "/catalog/articles/a-1"},
		{http.MethodPost, "/quizzes/q-1/attempts"},
		{http.MethodPost, "/simulators/ahorro/run"},
		{http.MethodGet, "/simulators/history"},
		{http.MethodGet, "/me/profile"},
		{http.MethodPatch, "/me/profile"},
		{http.MethodGet, "/me/progress"},
		{http.MethodGet, "/me/report"},
		{http.MethodGet, "/me/notifications"},
		{http.MethodPost, "/me/notifications/n-1/read"},
		{http.MethodDelete, "/me/account"},
		{http.MethodPatch, "/me/password"},
		{http.MethodGet, "/me/data"},
		{http.MethodPost, "/editorial/articles"},
		{http.MethodPost, "/editorial/versions/v-1/submit"},
		{http.MethodPost, "/editorial/versions/v-1/publish"},
	} {
		rec := h.do(t, route.method, route.target, `{}`, false)
		require.Equal(t, http.StatusUnauthorized, rec.Code,
			"%s %s debería exigir token", route.method, route.target)
	}
}

// TestEditorialRoutesEnforceRoles cubre FR-006 y la mitad de FR-008 que sí vive aquí.
func TestEditorialRoutesEnforceRoles(t *testing.T) {
	t.Parallel()

	t.Run("un usuario final no toca nada editorial", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		for _, target := range []string{"/editorial/articles", "/editorial/versions/v-1/submit", "/editorial/versions/v-1/publish"} {
			rec := h.do(t, http.MethodPost, target, `{}`, true)
			require.Equal(t, http.StatusForbidden, rec.Code, target)
		}
	})

	t.Run("un editor crea y envía pero NO publica", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t, withRoles(handler.RoleEditor))

		rec := h.do(t, http.MethodPost, "/editorial/articles", `{"title":"t","category":"c","body":"b"}`, true)
		require.Equal(t, http.StatusCreated, rec.Code)

		// La separación editor/coordinador es la barrera de FR-008 que el Gateway SÍ
		// puede aplicar: sin ella, un editor publicaría su propio artículo sin que nadie
		// lo revisara.
		rec = h.do(t, http.MethodPost, "/editorial/versions/v-1/publish", `{}`, true)
		require.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("un coordinador publica", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t, withRoles(handler.RoleCoordinadorEditoria))
		rec := h.do(t, http.MethodPost, "/editorial/versions/v-1/publish", `{}`, true)
		require.Equal(t, http.StatusOK, rec.Code)
	})
}

// TestActorAlwaysComesFromTheToken es el invariante que hace útil al de rol.
//
// Comprobar `approved_by ≠ created_by` en Aprendizaje no sirve de nada si el
// `approved_by` lo elige quien envía la petición.
func TestActorAlwaysComesFromTheToken(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleCoordinadorEditoria))

	// El cuerpo intenta colar otro actor; `DisallowUnknownFields` lo rechaza de plano.
	rec := h.do(t, http.MethodPost, "/editorial/articles",
		`{"title":"t","category":"c","body":"b","editor_id":"otro-usuario"}`, true)
	require.Equal(t, http.StatusBadRequest, rec.Code)

	rec = h.do(t, http.MethodPost, "/editorial/articles", `{"title":"t","category":"c","body":"b"}`, true)
	require.Equal(t, http.StatusCreated, rec.Code)
	require.Equal(t, testUserID, h.learning.lastDraft.GetEditorId())

	rec = h.do(t, http.MethodPost, "/editorial/versions/v-1/publish", `{}`, true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, testUserID, h.learning.lastPublish.GetCoordinatorId())
}

// TestRevokedSessionIsRejectedImmediately cubre FR-004.
func TestRevokedSessionIsRejectedImmediately(t *testing.T) {
	t.Parallel()
	h := newHarness(t, func(_ *harness, d *handler.Deps) {
		d.Blacklist = fakeBlacklist{revoked: true}
	})

	rec := h.do(t, http.MethodGet, "/me/progress", "", true)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

// TestBlacklistFailureFailsClosed: si no se puede saber si un token fue revocado, se
// rechaza. Tratar la duda como «no revocado» convertiría una caída de Redis en la
// reactivación simultánea de todas las sesiones cerradas.
func TestBlacklistFailureFailsClosed(t *testing.T) {
	t.Parallel()
	h := newHarness(t, func(_ *harness, d *handler.Deps) {
		d.Blacklist = fakeBlacklist{err: context.DeadlineExceeded}
	})

	rec := h.do(t, http.MethodGet, "/me/progress", "", true)
	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
}

// ── rate limiting ───────────────────────────────────────────────────────────

func TestRateLimitBlocksWithRetryAfter(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.limiter.allowed = false

	rec := h.do(t, http.MethodPost, "/oauth/token", `{"grant_type":"refresh_token"}`, false)
	require.Equal(t, http.StatusTooManyRequests, rec.Code)
	require.Equal(t, "30", rec.Header().Get("Retry-After"))
}

// TestRateLimitAppliesPerUserOnceAuthenticated documenta por qué hay DOS límites.
//
// El middleware global corre ANTES de `Authenticate`, así que en ese punto no existe
// identidad y la clave solo puede ser la IP. El límite por usuario tiene que aplicarse
// dentro del grupo autenticado; si no, la cuota por identidad no se aplica nunca —y el
// comentario que dice que sí sería falso.
func TestRateLimitAppliesPerUserOnceAuthenticated(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodGet, "/me/progress", "", true)
	require.NotEqual(t, http.StatusTooManyRequests, rec.Code)

	require.Len(t, h.limiter.keys, 2, "una petición autenticada consulta el límite de IP y el de usuario")
	require.True(t, strings.HasPrefix(h.limiter.keys[0], "ip:"), "el primero es por IP: %s", h.limiter.keys[0])
	require.Equal(t, "user:"+testUserID, h.limiter.keys[1])
}

func TestPublicRouteIsLimitedByIPOnly(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	h.do(t, http.MethodPost, "/auth/register", `{"email":"a@b.co","password":"x","display_name":"A"}`, false)
	require.Len(t, h.limiter.keys, 1)
	require.True(t, strings.HasPrefix(h.limiter.keys[0], "ip:"))
}

// ── OAuth2 ──────────────────────────────────────────────────────────────────

func TestAuthorizeRejectsPlainPKCE(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	// `validate` sin asignar: si el handler llegara a llamarlo, el test entra en pánico.
	// Esa es precisamente la afirmación — el borde rechaza `plain` SIN comprobar
	// credenciales, porque `plain` transmite el verificador en claro y anula PKCE.

	rec := h.do(t, http.MethodPost, "/oauth/authorize",
		`{"email":"a@b.co","password":"x","client_id":"spa","redirect_uri":"https://app/cb","code_challenge":"abc","code_challenge_method":"plain"}`, false)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestAuthorizeIssuesCodeBoundToTheChallenge(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.auth.validate = func(*authv1.ValidateCredentialsRequest) (*authv1.ValidateCredentialsResponse, error) {
		return &authv1.ValidateCredentialsResponse{Valid: true, UserId: testUserID, EmailVerified: true, LoginStatus: "active"}, nil
	}
	var issued *authv1.IssueAuthCodeRequest
	h.auth.issue = func(in *authv1.IssueAuthCodeRequest) (*authv1.IssueAuthCodeResponse, error) {
		issued = in
		return &authv1.IssueAuthCodeResponse{Code: "codigo-1"}, nil
	}

	rec := h.do(t, http.MethodPost, "/oauth/authorize",
		`{"email":"a@b.co","password":"x","client_id":"spa","redirect_uri":"https://app/cb","code_challenge":"reto","code_challenge_method":"S256","scopes":["openid"]}`, false)
	require.Equal(t, http.StatusOK, rec.Code)

	body := decode[handler.AuthorizeResponse](t, rec)
	require.Equal(t, "codigo-1", body.Code)

	// El reto tiene que llegar INTACTO a Auth: es lo único que liga el código a la
	// instancia que lo pidió.
	require.Equal(t, "reto", issued.GetCodeChallenge())
	require.Equal(t, testUserID, issued.GetUserId())

	// Un token no puede quedarse en la caché de un proxy (RFC 6749 §5.1).
	require.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
}

// TestAuthorizeIsNotAnAccountOracle: correo inexistente y contraseña incorrecta tienen
// que ser indistinguibles, o el endpoint enumera cuentas registradas.
func TestAuthorizeIsNotAnAccountOracle(t *testing.T) {
	t.Parallel()

	responses := []*authv1.ValidateCredentialsResponse{
		{Valid: false},                     // el correo no existe
		{Valid: false, UserId: testUserID}, // existe, contraseña incorrecta
	}
	var recorded []string
	for _, resp := range responses {
		h := newHarness(t)
		h.auth.validate = func(*authv1.ValidateCredentialsRequest) (*authv1.ValidateCredentialsResponse, error) {
			return resp, nil
		}
		rec := h.do(t, http.MethodPost, "/oauth/authorize",
			`{"email":"a@b.co","password":"x","client_id":"spa","redirect_uri":"https://app/cb","code_challenge":"reto","code_challenge_method":"S256"}`, false)
		require.Equal(t, http.StatusUnauthorized, rec.Code)
		recorded = append(recorded, rec.Body.String())
	}
	require.Equal(t, recorded[0], recorded[1], "las dos respuestas deben ser idénticas byte a byte")
}

func TestAuthorizeBlocksUnverifiedEmail(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.auth.validate = func(*authv1.ValidateCredentialsRequest) (*authv1.ValidateCredentialsResponse, error) {
		return &authv1.ValidateCredentialsResponse{Valid: true, UserId: testUserID, EmailVerified: false, LoginStatus: "pending_verification"}, nil
	}

	rec := h.do(t, http.MethodPost, "/oauth/authorize",
		`{"email":"a@b.co","password":"x","client_id":"spa","redirect_uri":"https://app/cb","code_challenge":"reto","code_challenge_method":"S256"}`, false)
	require.Equal(t, http.StatusForbidden, rec.Code)
}

func TestTokenExchangesCodeAndRotatesRefresh(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.auth.exchange = func(in *authv1.ExchangeCodeRequest) (*authv1.TokenResponse, error) {
		require.Equal(t, "codigo-1", in.GetCode())
		require.Equal(t, "verificador", in.GetCodeVerifier())
		return &authv1.TokenResponse{AccessToken: "at", RefreshToken: "rt", TokenType: "Bearer", ExpiresIn: 900}, nil
	}

	rec := h.do(t, http.MethodPost, "/oauth/token",
		`{"grant_type":"authorization_code","code":"codigo-1","code_verifier":"verificador","client_id":"spa","redirect_uri":"https://app/cb"}`, false)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "no-store", rec.Header().Get("Cache-Control"))

	body := decode[handler.TokenResponse](t, rec)
	require.Equal(t, "at", body.AccessToken)
	require.Equal(t, "rt", body.RefreshToken)
	require.Equal(t, int32(900), body.ExpiresIn)
}

func TestTokenRejectsUnsupportedGrants(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	for _, grant := range []string{"client_credentials", "password", ""} {
		rec := h.do(t, http.MethodPost, "/oauth/token", `{"grant_type":"`+grant+`"}`, false)
		require.Equal(t, http.StatusBadRequest, rec.Code, "grant %q", grant)
		require.Equal(t, "unsupported_grant_type", decode[handler.ErrorBody](t, rec).Code)
	}
}

func TestTokenRequiresTheParametersOfItsGrant(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	// Sin `code_verifier` no hay PKCE que comprobar; se corta en el borde antes de
	// molestar a Auth (`exchange` sin asignar entraría en pánico si se llamara).
	rec := h.do(t, http.MethodPost, "/oauth/token", `{"grant_type":"authorization_code","code":"c"}`, false)
	require.Equal(t, http.StatusBadRequest, rec.Code)

	rec = h.do(t, http.MethodPost, "/oauth/token", `{"grant_type":"refresh_token"}`, false)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

// TestLogoutRevokesTheTokenThatAuthenticates: nunca uno enviado en el cuerpo.
func TestLogoutRevokesTheTokenThatAuthenticates(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodPost, "/auth/logout", "", true)
	require.Equal(t, http.StatusNoContent, rec.Code)
	require.Equal(t, []string{"token-de-prueba"}, h.auth.revoked)
}

// ── precisión decimal (Principio VIII) ──────────────────────────────────────

// TestQuizScoreCrossesTheEdgeUntouched es la prueba de Principio VIII del borde.
//
// El valor se compara sobre el JSON EN BRUTO y no sobre un struct decodificado: si el
// campo fuera numérico, `json.Unmarshal` a un `string` fallaría o —peor— un
// `interface{}` daría un `float64` y la prueba pasaría con el error dentro. Sobre el
// texto, `"85.55"` con comillas es inequívoco.
func TestQuizScoreCrossesTheEdgeUntouched(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.orchestrator.grading = &orchestratorv1.QuizGradingResult{
		AttemptId: "at-1", AttemptNo: 2, Score: "85.55", Passed: true, PointsAfter: 120,
	}

	rec := h.do(t, http.MethodPost, "/quizzes/q-1/attempts", `{"answers":{"p1":"a"}}`, true)
	require.Equal(t, http.StatusCreated, rec.Code)
	require.Contains(t, rec.Body.String(), `"score":"85.55"`)
	require.NotContains(t, rec.Body.String(), `"score":85.55`)

	// El usuario sale del token: si viniera del cuerpo, cualquiera acumularía puntos en
	// la cuenta de otra persona.
	require.Equal(t, testUserID, h.orchestrator.lastGrading.GetUserId())
	require.Equal(t, "q-1", h.orchestrator.lastGrading.GetQuizId())
}

// TestTrailingZerosSurviveTheEdge: `"1500000.00"` no puede volverse `"1500000"` ni
// `1500000`. Los ceros a la derecha son significativos en un monto, y cualquier paso por
// un float los perdería junto con los centavos.
func TestTrailingZerosSurviveTheEdge(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.orchestrator.simulation = &orchestratorv1.SimulationResult{
		SimulationId: "s-1",
		Result:       map[string]string{"valor_futuro": "1500000.00", "interes": "0.0450"},
	}

	rec := h.do(t, http.MethodPost, "/simulators/ahorro/run", `{"currency":"COP","inputs":{"monto":"1000000.00"}}`, true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"1500000.00"`)
	require.Contains(t, rec.Body.String(), `"0.0450"`)

	// Y los de ENTRADA llegan igual de intactos al Orquestador.
	require.Equal(t, "1000000.00", h.orchestrator.lastSimulation.GetInputs()["monto"])
}

func TestUnknownCalcTypeIsRejectedAtTheEdge(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	// `orchestrator.simulation` sin asignar: si el handler llamara al Orquestador con un
	// enum cero, devolvería `nil` y el mapeo entraría en pánico. La afirmación es que ni
	// siquiera llega ahí.
	rec := h.do(t, http.MethodPost, "/simulators/hipoteca/run", `{"inputs":{}}`, true)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSimulationDefaultsToCOP(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.orchestrator.simulation = &orchestratorv1.SimulationResult{SimulationId: "s-1", Result: map[string]string{}}

	rec := h.do(t, http.MethodPost, "/simulators/credito/run", `{"inputs":{"monto":"1.00"}}`, true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "COP", h.orchestrator.lastSimulation.GetCurrency())
}

func TestHistoryPublishesCalcTypeAsItsPathName(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.simulator.history = &simulatorv1.ListHistoryResponse{
		Items: []*simulatorv1.ListHistoryResponse_Entry{{
			SimulationId: "s-1",
			CalcType:     simulatorv1.CalcType_CALC_TYPE_COLOMBIA_ESPECIFICA,
			Currency:     "COP",
			Result:       map[string]string{"total": "12345.67"},
		}},
		Page: &commonv1.PageResponse{TotalSize: 1},
	}

	rec := h.do(t, http.MethodGet, "/simulators/history", "", true)
	require.Equal(t, http.StatusOK, rec.Code)
	// El entero del enum es un detalle del transporte gRPC; publicarlo obligaría al
	// cliente a mantener su propia tabla de equivalencias.
	require.Contains(t, rec.Body.String(), `"calc_type":"colombia_especifica"`)
	require.Contains(t, rec.Body.String(), `"12345.67"`)
}

// ── mapeo y listados ────────────────────────────────────────────────────────

// TestEmptyListsSerializeAsArrayNotNull: un `null` haría fallar cualquier cliente que
// itere el resultado.
func TestEmptyListsSerializeAsArrayNotNull(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.learning.articles = &learningv1.ListPublishedResponse{Page: &commonv1.PageResponse{}}

	rec := h.do(t, http.MethodGet, "/catalog/articles", "", true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"items":[]`)
}

func TestNotificationPayloadIsNestedJSON(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.users.inbox = &usersv1.ListInAppResponse{
		Items: []*usersv1.ListInAppResponse_Item{
			{Id: "n-1", Type: "hito_progreso", ReadState: "unread", PayloadJson: `{"puntos":100}`},
			// Un payload corrupto se OMITE en lugar de invalidar toda la respuesta: un
			// dato malo no puede convertir la bandeja entera en una página en blanco.
			{Id: "n-2", Type: "recordatorio", ReadState: "read", PayloadJson: `{roto`},
		},
		Page: &commonv1.PageResponse{TotalSize: 2},
	}

	rec := h.do(t, http.MethodGet, "/me/notifications", "", true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"payload":{"puntos":100}`)
	require.NotContains(t, rec.Body.String(), `roto`)

	var page handler.Page[handler.InAppNotification]
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &page))
	require.Len(t, page.Items, 2)
}

func TestMarkReadSendsTheUserFromTheToken(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodPost, "/me/notifications/n-1/read", "", true)
	require.Equal(t, http.StatusNoContent, rec.Code)
	require.Equal(t, testUserID, h.users.lastMark.GetUserId())
	require.Equal(t, "n-1", h.users.lastMark.GetNotificationId())
}

// ── FR-018: reporte estadístico de actividad ────────────────────────────────

func TestActivityReportSendsTheUserFromTheToken(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodGet, "/me/report", "", true)
	require.Equal(t, http.StatusOK, rec.Code)

	report := decode[handler.ActivityReport](t, rec)
	require.Equal(t, testUserID, report.UserID)
	require.EqualValues(t, 3, report.QuizzesAttempted)
	require.EqualValues(t, 2, report.SimulationsRun)
}

// ── FR-005: cambio de contraseña ────────────────────────────────────────────

func TestChangePasswordSendsTheUserFromTheToken(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodPatch, "/me/password",
		`{"current_password":"actual-123","new_password":"nueva-456"}`, true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, testUserID, h.auth.lastChangePass.GetUserId())
	require.Equal(t, "actual-123", h.auth.lastChangePass.GetCurrentPassword())
	require.Equal(t, "nueva-456", h.auth.lastChangePass.GetNewPassword())
}

// TestChangePasswordTranslatesAWrongCurrentPassword: Auth rechaza con
// Unauthenticated y el borde tiene que devolver un 401 legible, no un 500.
func TestChangePasswordTranslatesAWrongCurrentPassword(t *testing.T) {
	t.Parallel()
	h := newHarness(t, func(h *harness, _ *handler.Deps) {
		h.auth.changePassErr = status.Error(codes.Unauthenticated, "credenciales inválidas")
	})

	rec := h.do(t, http.MethodPatch, "/me/password",
		`{"current_password":"mala","new_password":"nueva-456"}`, true)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

// ── FR-029: consulta completa de datos personales ───────────────────────────

func TestPersonalDataCombinesTheFourSources(t *testing.T) {
	t.Parallel()
	h := newHarness(t, func(h *harness, _ *handler.Deps) {
		h.users.profile = &usersv1.Profile{Email: "ana@fintcart.co", DisplayName: "Ana"}
		h.learning.attempts = &learningv1.ListAttemptsResponse{
			Items: []*learningv1.ListAttemptsResponse_Attempt{
				{AttemptId: "at-1", AttemptNo: 1, Score: "85.50", CreatedAt: "2026-08-01T12:00:00Z"},
			},
			Page: &commonv1.PageResponse{TotalSize: 1},
		}
		h.simulator.history = &simulatorv1.ListHistoryResponse{
			Items: []*simulatorv1.ListHistoryResponse_Entry{
				{SimulationId: "sim-1", CalcType: simulatorv1.CalcType_CALC_TYPE_CREDITO, Currency: "COP"},
			},
			Page: &commonv1.PageResponse{TotalSize: 1},
		}
	})

	rec := h.do(t, http.MethodGet, "/me/data", "", true)
	require.Equal(t, http.StatusOK, rec.Code)

	data := decode[handler.PersonalData](t, rec)
	require.Equal(t, "ana@fintcart.co", data.Profile.Email)
	require.Equal(t, int32(120), data.Progress.Points)
	require.Len(t, data.QuizAttempts.Items, 1)
	// La calificación cruza el borde SIN tocarse (Principio VIII): ni redondeo
	// ni reformateo, byte a byte lo que devolvió Aprendizaje.
	require.Equal(t, "85.50", data.QuizAttempts.Items[0].Score)
	require.Len(t, data.Simulations.Items, 1)
	require.Equal(t, "credito", data.Simulations.Items[0].CalcType)
}

// TestPatchProfileDistinguishesAbsentFromEmpty es el motivo de que los campos de
// `UpdateProfileRequest` sean punteros.
func TestPatchProfileDistinguishesAbsentFromEmpty(t *testing.T) {
	t.Parallel()

	t.Run("solo preferencias no toca el nombre", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		rec := h.do(t, http.MethodPatch, "/me/profile", `{"preferences":{"idioma":"es"}}`, true)
		require.Equal(t, http.StatusOK, rec.Code)
		require.Empty(t, h.users.lastUpdate.GetDisplayName())
		require.Equal(t, map[string]string{"idioma": "es"}, h.users.lastUpdate.GetPreferences())
	})

	t.Run("un cuerpo vacío es un error del cliente", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		// Devolver 200 haría creer que se guardó algo; casi siempre es un nombre de
		// campo mal escrito.
		rec := h.do(t, http.MethodPatch, "/me/profile", `{}`, true)
		require.Equal(t, http.StatusBadRequest, rec.Code)
	})
}

// ── traducción de errores ───────────────────────────────────────────────────

// TestInternalErrorDetailsNeverReachTheClient: el borde es la frontera donde los
// nombres de host, de tabla y el detalle del driver no deben cruzar.
func TestInternalErrorDetailsNeverReachTheClient(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.users.profile = nil // provoca un `NotFound` con mensaje interno

	rec := h.do(t, http.MethodGet, "/me/profile", "", true)
	require.Equal(t, http.StatusNotFound, rec.Code)
	require.NotContains(t, rec.Body.String(), "sin perfil")
	require.Equal(t, "not_found", decode[handler.ErrorBody](t, rec).Code)
}

func TestOversizedBodyIsRejected(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	// Sin tope, `json.Decoder` leería en memoria todo lo que el cliente enviara contra
	// una ruta pública sin autenticar.
	huge := `{"email":"` + strings.Repeat("a", 2<<20) + `"}`
	rec := h.do(t, http.MethodPost, "/auth/register", huge, false)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestUnknownFieldsAreRejected(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	// Un campo que el cliente cree enviar y el servidor ignora en silencio es un fallo
	// que se descubre en producción («guardé mis preferencias y no se guardaron»).
	rec := h.do(t, http.MethodPatch, "/me/profile", `{"preferencias":{"idioma":"es"}}`, true)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}
