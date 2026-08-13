package server

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"sync"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	authv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/auth/v1"
	commonv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/common/v1"
	learningv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/learning/v1"
	usersv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/users/v1"
)

// Dobles de los servicios participantes, compartidos por las pruebas de integración
// de saga (T071, T072).
//
// La diferencia con los dobles de `steps/steps_test.go` es lo que MODELAN. Aquellos
// registran la llamada y devuelven éxito, porque allí lo que se prueba es qué RPC
// invoca cada paso. Estos reproducen las propiedades de las que dependen las sagas
// —unicidad del correo, monotonía del puntaje, idempotencia de la bandeja—, porque
// aquí lo que se prueba es si la saga sigue siendo correcta cuando el motor la
// interrumpe y la repite.
//
// La distinción importa: contra un doble permisivo, una saga que aplicara el puntaje
// dos veces pasaría la prueba. Estos dobles fallan si la saga hace algo que un
// participante real rechazaría.
//
// Los tres embeben la interfaz GENERADA en vez de implementarla entera: un método que
// la prueba no esperaba produce un pánico de puntero nil, no un cero silencioso que la
// haría pasar por el motivo equivocado.

// failures inyecta el fallo de un RPC concreto por su nombre.
//
// Se indexa por nombre y no por un booleano por método porque las pruebas de T071
// recorren los pasos uno a uno: `for cada paso { falla ese y solo ese }`.
type failures map[string]error

func (f failures) check(method string) error {
	return f[method]
}

// ── Autenticación ───────────────────────────────────────────────────────────

type fakeAuthSvc struct {
	authv1.AuthServiceClient

	mu sync.Mutex
	// credentials es `user_id → email`; emails, el índice inverso que hace cumplir
	// la unicidad de FR-001.
	credentials map[string]string
	emails      map[string]string
	anonymized  []string
	activated   []*authv1.ActivateCredentialRequest
	tokens      int

	fail failures
}

func newFakeAuth() *fakeAuthSvc {
	return &fakeAuthSvc{
		credentials: map[string]string{},
		emails:      map[string]string{},
		fail:        failures{},
	}
}

// CreateCredential es idempotente por `user_id` y rechaza el correo repetido.
//
// Las dos propiedades son las que justifican el orden de la saga de registro: la
// credencial va primero porque es la que decide si el correo está libre.
func (f *fakeAuthSvc) CreateCredential(
	_ context.Context, req *authv1.CreateCredentialRequest, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if err := f.fail.check("CreateCredential"); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	if existing, ok := f.credentials[req.GetUserId()]; ok && existing == req.GetEmail() {
		return &commonv1.OpResult{Success: true}, nil // reintento del mismo paso
	}
	if owner, taken := f.emails[req.GetEmail()]; taken && owner != req.GetUserId() {
		return nil, status.Error(codes.AlreadyExists, "el correo ya está registrado")
	}
	f.credentials[req.GetUserId()] = req.GetEmail()
	f.emails[req.GetEmail()] = req.GetUserId()
	return &commonv1.OpResult{Success: true}, nil
}

// IssueVerificationToken devuelve un token distinto por llamada, como el real.
func (f *fakeAuthSvc) IssueVerificationToken(
	_ context.Context, _ *authv1.UserRef, _ ...grpc.CallOption,
) (*authv1.VerificationToken, error) {
	if err := f.fail.check("IssueVerificationToken"); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	f.tokens++
	return &authv1.VerificationToken{
		Token:     fmt.Sprintf("token-%d", f.tokens),
		ExpiresAt: "2026-08-02T12:00:00Z",
	}, nil
}

func (f *fakeAuthSvc) ActivateCredential(
	_ context.Context, req *authv1.ActivateCredentialRequest, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if err := f.fail.check("ActivateCredential"); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	f.activated = append(f.activated, req)
	return &commonv1.OpResult{Success: true}, nil
}

// RevokeAndAnonymizeCredential LIBERA el correo, igual que el real.
//
// Sin eso, la prueba de compensación no demostraría lo que importa: que tras un
// registro deshecho la persona puede volver a intentarlo con la misma dirección.
func (f *fakeAuthSvc) RevokeAndAnonymizeCredential(
	_ context.Context, req *authv1.UserRef, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if err := f.fail.check("RevokeAndAnonymizeCredential"); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	f.anonymized = append(f.anonymized, req.GetUserId())
	if email, ok := f.credentials[req.GetUserId()]; ok {
		delete(f.emails, email)
		delete(f.credentials, req.GetUserId())
	}
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeAuthSvc) snapshot() (creds, anonymized int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.credentials), len(f.anonymized)
}

// ── Usuarios ────────────────────────────────────────────────────────────────

type fakeUsersSvc struct {
	usersv1.UsersServiceClient

	mu       sync.Mutex
	profiles map[string]string // user_id → email
	verified []string
	// bestScore es `user_id|quiz_id → mejor puntaje`, la tabla `quiz_best_score`.
	bestScore map[string]*big.Rat
	// inbox está indexado por (event_id, type), que es la identidad de una entrada
	// de la bandeja.
	inbox     map[string]map[string]any
	anonymize []string

	fail failures
}

func newFakeUsers() *fakeUsersSvc {
	return &fakeUsersSvc{
		profiles:  map[string]string{},
		bestScore: map[string]*big.Rat{},
		inbox:     map[string]map[string]any{},
		fail:      failures{},
	}
}

func (f *fakeUsersSvc) CreateProfile(
	_ context.Context, req *usersv1.CreateProfileRequest, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if err := f.fail.check("CreateProfile"); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	f.profiles[req.GetUserId()] = req.GetEmail() // idempotente por user_id (D-04)
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeUsersSvc) MarkEmailVerified(
	_ context.Context, req *usersv1.UserRef, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if err := f.fail.check("MarkEmailVerified"); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	f.verified = append(f.verified, req.GetUserId())
	return &commonv1.OpResult{Success: true}, nil
}

// ApplyQuizScore reproduce la MONOTONÍA de D-07: se guarda el puntaje solo si supera
// al mejor almacenado, y los puntos son `FLOOR(SUM(best_score))`.
//
// La comparación usa `math/big.Rat` y no `float64`. No es purismo: `85.55` no es
// representable en binario, y un doble aquí haría que la prueba del Principio VIII
// —la que existe justamente para detectar una centésima perdida— pasara con una
// implementación que la pierde. `big.Rat` es de la biblioteca estándar, así que
// tampoco añade una dependencia decimal a un servicio que no debe interpretar montos.
func (f *fakeUsersSvc) ApplyQuizScore(
	_ context.Context, req *usersv1.ApplyQuizScoreRequest, _ ...grpc.CallOption,
) (*usersv1.ProgressView, error) {
	if err := f.fail.check("ApplyQuizScore"); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	score, ok := new(big.Rat).SetString(req.GetScore())
	if !ok {
		// El real lo rechazaría con el CHECK de la columna NUMERIC. Que falle aquí es
		// lo que convierte «la saga mandó un número JSON» en una prueba en rojo.
		return nil, status.Errorf(codes.InvalidArgument, "puntaje %q no es decimal", req.GetScore())
	}

	key := req.GetUserId() + "|" + req.GetQuizId()
	if best, seen := f.bestScore[key]; !seen || score.Cmp(best) > 0 {
		f.bestScore[key] = score
	}

	return &usersv1.ProgressView{UserId: req.GetUserId(), Points: f.points(req.GetUserId())}, nil
}

// points es `FLOOR(SUM(best_score))::INTEGER` sobre los cuestionarios del usuario.
func (f *fakeUsersSvc) points(userID string) int32 {
	total := new(big.Rat)
	for key, score := range f.bestScore {
		if key[:len(userID)] == userID {
			total.Add(total, score)
		}
	}
	floored := new(big.Int).Quo(total.Num(), total.Denom())
	return int32(floored.Int64())
}

// AppendInAppNotification identifica la entrada por el par (`event_id`, `type`).
//
// Es la propiedad que hace reintentable el paso: una reentrega escribe la misma clave
// y no una segunda entrada indistinguible en la bandeja del usuario. Que sea el PAR y
// no el `event_id` a solas es lo que permite que la saga de calificación produzca dos
// notificaciones de la misma ocurrencia.
func (f *fakeUsersSvc) AppendInAppNotification(
	_ context.Context, req *usersv1.InAppNotification, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if err := f.fail.check("AppendInAppNotification"); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	if req.GetEventId() == "" {
		// El real lo rechaza en vez de recaer en una derivación por contenido: un
		// productor que lo olvidara tendría una deduplicación peor sin enterarse.
		return nil, status.Error(codes.InvalidArgument, "falta event_id")
	}

	var body map[string]any
	if err := json.Unmarshal([]byte(req.GetPayloadJson()), &body); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "payload_json ilegible: %v", err)
	}
	f.inbox[req.GetEventId()+"|"+req.GetType()] = body
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeUsersSvc) AnonymizeProfile(
	_ context.Context, req *usersv1.UserRef, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if err := f.fail.check("AnonymizeProfile"); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	f.anonymize = append(f.anonymize, req.GetUserId())
	delete(f.profiles, req.GetUserId())
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeUsersSvc) inboxEntry(eventID, notifType string) (map[string]any, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	body, ok := f.inbox[eventID+"|"+notifType]
	return body, ok
}

func (f *fakeUsersSvc) inboxSize() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.inbox)
}

// ── Aprendizaje ─────────────────────────────────────────────────────────────

type fakeLearningSvc struct {
	learningv1.LearningServiceClient

	mu sync.Mutex
	// score y passed son lo que este participante DECIDE. El umbral de aprobación es
	// suyo (Principio VI): la saga transporta el veredicto, no lo calcula.
	score      string
	passed     bool
	attempts   int
	anonymized []string

	fail failures
}

func newFakeLearning(score string, passed bool) *fakeLearningSvc {
	return &fakeLearningSvc{score: score, passed: passed, fail: failures{}}
}

func (f *fakeLearningSvc) GradeAndStoreAttempt(
	_ context.Context, _ *learningv1.GradeRequest, _ ...grpc.CallOption,
) (*learningv1.GradeResponse, error) {
	if err := f.fail.check("GradeAndStoreAttempt"); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	// El intento SIEMPRE se persiste, apruebe o no (FR-016), y el contador nunca
	// retrocede: es lo que hace que «deshacer un intento» sea falsificar el historial
	// y no compensar.
	f.attempts++
	return &learningv1.GradeResponse{
		AttemptId: fmt.Sprintf("attempt-%d", f.attempts),
		AttemptNo: int32(f.attempts),
		Score:     f.score,
		Passed:    f.passed,
	}, nil
}

func (f *fakeLearningSvc) attemptCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.attempts
}

// AnonymizeAttempts registra a quién se le disoció el historial (FR-030). No
// borra `attempts`: la anonimización quita PII, no el hecho de que se rindió el
// cuestionario (FR-016).
func (f *fakeLearningSvc) AnonymizeAttempts(
	_ context.Context, req *learningv1.UserRef, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if err := f.fail.check("AnonymizeAttempts"); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	f.anonymized = append(f.anonymized, req.GetUserId())
	return &commonv1.OpResult{Success: true}, nil
}
