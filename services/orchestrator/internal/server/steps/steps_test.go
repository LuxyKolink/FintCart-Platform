// Pruebas de las DEFINICIONES de saga (T093–T096).
//
// Aquí no se prueba el motor —eso es `internal/server/saga_test.go`— sino lo que cada
// definición hace con sus participantes: qué RPC invoca, con qué argumentos y qué
// eventos devuelve. Los pasos son el único sitio del Orquestador donde un dato de otro
// servicio se toca, así que es donde puede perderse una centésima de una calificación
// o colarse un dato personal en un evento de auditoría.
//
// Los dobles embeben la interfaz GENERADA en lugar de implementarla entera: un método
// que la prueba no esperaba produce un pánico de puntero nil y no un cero silencioso
// que la haría pasar por el motivo equivocado.
package steps

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"

	authv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/auth/v1"
	commonv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/common/v1"
	learningv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/learning/v1"
	usersv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/users/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/events"
)

const (
	testUserID = "3f0f8b2e-2c53-4a2c-9f0a-1d2e3f4a5b6c"
	testSagaID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
	testQuizID = "11111111-2222-4333-8444-555555555555"
)

// ── dobles de los participantes ─────────────────────────────────────────────

type fakeAuth struct {
	authv1.AuthServiceClient

	created  *authv1.CreateCredentialRequest
	revoked  []string
	activate []*authv1.ActivateCredentialRequest
	err      error

	// issued cuenta las emisiones de token; `issuedErr`, si está, las hace fallar.
	issued    int
	issuedErr error
}

// IssueVerificationToken devuelve un token DISTINTO en cada llamada, igual que el
// servicio real. Uno fijo dejaría pasar una implementación que reemitiera siempre lo
// mismo, y entonces pedir un reenvío no invalidaría el enlace anterior.
func (f *fakeAuth) IssueVerificationToken(
	_ context.Context, _ *authv1.UserRef, _ ...grpc.CallOption,
) (*authv1.VerificationToken, error) {
	if f.issuedErr != nil {
		return nil, f.issuedErr
	}
	f.issued++
	return &authv1.VerificationToken{
		Token:     fmt.Sprintf("token-verificacion-%d", f.issued),
		ExpiresAt: "2026-08-02T12:00:00Z",
	}, nil
}

func (f *fakeAuth) CreateCredential(
	_ context.Context, req *authv1.CreateCredentialRequest, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if f.err != nil {
		return nil, f.err
	}
	f.created = req
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeAuth) RevokeAndAnonymizeCredential(
	_ context.Context, req *authv1.UserRef, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	f.revoked = append(f.revoked, req.GetUserId())
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeAuth) ActivateCredential(
	_ context.Context, req *authv1.ActivateCredentialRequest, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if f.err != nil {
		return nil, f.err
	}
	f.activate = append(f.activate, req)
	return &commonv1.OpResult{Success: true}, nil
}

type fakeUsers struct {
	usersv1.UsersServiceClient

	profiles  []*usersv1.CreateProfileRequest
	verified  []string
	applied   *usersv1.ApplyQuizScoreRequest
	points    int32
	inapp     []*usersv1.InAppNotification
	inappErr  error
	anonymize []string
}

func (f *fakeUsers) CreateProfile(
	_ context.Context, req *usersv1.CreateProfileRequest, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	f.profiles = append(f.profiles, req)
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeUsers) MarkEmailVerified(
	_ context.Context, req *usersv1.UserRef, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	f.verified = append(f.verified, req.GetUserId())
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeUsers) ApplyQuizScore(
	_ context.Context, req *usersv1.ApplyQuizScoreRequest, _ ...grpc.CallOption,
) (*usersv1.ProgressView, error) {
	f.applied = req
	return &usersv1.ProgressView{UserId: req.GetUserId(), Points: f.points}, nil
}

func (f *fakeUsers) AppendInAppNotification(
	_ context.Context, req *usersv1.InAppNotification, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if f.inappErr != nil {
		return nil, f.inappErr
	}
	f.inapp = append(f.inapp, req)
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeUsers) AnonymizeProfile(
	_ context.Context, req *usersv1.UserRef, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	f.anonymize = append(f.anonymize, req.GetUserId())
	return &commonv1.OpResult{Success: true}, nil
}

type fakeLearning struct {
	learningv1.LearningServiceClient

	graded *learningv1.GradeRequest
	resp   *learningv1.GradeResponse
}

func (f *fakeLearning) GradeAndStoreAttempt(
	_ context.Context, req *learningv1.GradeRequest, _ ...grpc.CallOption,
) (*learningv1.GradeResponse, error) {
	f.graded = req
	return f.resp, nil
}

// newState construye el estado vivo de una saga como lo haría el motor.
func newState(payload map[string]any, secrets map[string]string) *State {
	if payload == nil {
		payload = map[string]any{}
	}
	return &State{SagaID: testSagaID, Step: 0, Payload: payload, Secrets: secrets}
}

// ── registro (T093) ─────────────────────────────────────────────────────────

func TestRegistrationCreatesCredentialAndProfileWithTheSameID(t *testing.T) {
	t.Parallel()
	auth, users := &fakeAuth{}, &fakeUsers{}
	def := RegistrationDefinition(Clients{Auth: auth, Users: users})
	st := newState(map[string]any{
		payloadUserID: testUserID, payloadEmail: "ana@fintcart.co", payloadDisplayName: "Ana",
	}, map[string]string{SecretPassword: "contraseña-valida-123"})

	for _, step := range def.Steps[:2] {
		_, err := step.Do(context.Background(), st)
		require.NoError(t, err)
	}

	require.Equal(t, testUserID, auth.created.GetUserId())
	require.Equal(t, "contraseña-valida-123", auth.created.GetPassword())
	require.Len(t, users.profiles, 1)
	// El MISMO identificador en los dos servicios: es la correlación por UUID opaco
	// del Principio III, y sin ella el perfil y la credencial serían dos cuentas.
	require.Equal(t, testUserID, users.profiles[0].GetUserId())
}

// TestRegistrationFailsWhenTheSecretIsGone es la prueba de la decisión de no
// persistir la contraseña.
//
// Reproduce una reanudación tras un reinicio: el payload sobrevive y los secretos no.
// Lo que NO puede pasar es que el paso continúe y cree una credencial con contraseña
// vacía, que sería una cuenta imposible de usar y muy fácil de no notar.
func TestRegistrationFailsWhenTheSecretIsGone(t *testing.T) {
	t.Parallel()
	auth := &fakeAuth{}
	def := RegistrationDefinition(Clients{Auth: auth, Users: &fakeUsers{}})
	st := newState(map[string]any{payloadUserID: testUserID, payloadEmail: "ana@fintcart.co"}, nil)

	_, err := def.Steps[0].Do(context.Background(), st)
	require.ErrorIs(t, err, ErrSecretUnavailable)
	require.Nil(t, auth.created, "no debe crearse ninguna credencial sin contraseña")
}

func TestRegistrationCompensatesBothParticipants(t *testing.T) {
	t.Parallel()
	auth, users := &fakeAuth{}, &fakeUsers{}
	def := RegistrationDefinition(Clients{Auth: auth, Users: users})
	st := newState(map[string]any{payloadUserID: testUserID}, nil)

	require.NoError(t, def.Steps[0].Compensate(context.Background(), st))
	require.NoError(t, def.Steps[1].Compensate(context.Background(), st))
	require.Equal(t, []string{testUserID}, auth.revoked)
	require.Equal(t, []string{testUserID}, users.anonymize)

	// El último paso no tiene compensación: un evento publicado no se despublica, y
	// por eso se emite cuando ya no queda nada que pueda fallar.
	require.Nil(t, def.Steps[2].Compensate)
}

func TestRegistrationEmitsTheEventWithAnOpaqueActor(t *testing.T) {
	t.Parallel()
	auth := &fakeAuth{}
	def := RegistrationDefinition(Clients{Auth: auth})
	st := newState(map[string]any{
		payloadUserID: testUserID, payloadEmail: "ana@fintcart.co", payloadDisplayName: "Ana",
	}, nil)

	produced, err := def.Steps[2].Do(context.Background(), st)
	require.NoError(t, err)
	require.Len(t, produced, 1)
	require.Equal(t, events.EventUserRegistered, produced[0].Type)
	// `actor_ref` es el UUID opaco: Auditoría lo exige y descarta el sobre que no lo
	// traiga, así que un paso que lo dejara vacío produciría un evento que se pierde.
	require.Equal(t, testUserID, produced[0].ActorRef)
	// El correo va dentro porque Notificación necesita una dirección a la que
	// escribir. Es la única excepción del catálogo y conviene que una prueba la fije.
	require.Equal(t, "ana@fintcart.co", produced[0].Payload["email"])
}

// El evento tiene que llevar TODO lo que hace falta para componer el enlace del
// correo. Notificación es un consumidor puro sin gRPC: lo que no venga en el payload
// no lo puede consultar en ningún sitio, y el correo saldría sin enlace utilizable.
func TestRegistrationCarriesEverythingTheEmailNeeds(t *testing.T) {
	t.Parallel()
	auth := &fakeAuth{}
	def := RegistrationDefinition(Clients{Auth: auth})
	st := newState(map[string]any{
		payloadUserID: testUserID, payloadEmail: "ana@fintcart.co", payloadDisplayName: "Ana",
	}, nil)

	produced, err := def.Steps[2].Do(context.Background(), st)
	require.NoError(t, err)
	require.Equal(t, 1, auth.issued)

	payload := produced[0].Payload
	// El `user_id` se repite dentro del payload además de ir en `actor_ref`:
	// `POST /auth/verify-email` lo exige junto al token, y Notificación solo lee el
	// payload.
	require.Equal(t, testUserID, payload[eventKeyUserID])
	require.Equal(t, "token-verificacion-1", payload[eventKeyVerificationToken])
	require.Equal(t, "2026-08-02T12:00:00Z", payload[eventKeyVerificationExp])
	require.Equal(t, "Ana", payload[eventKeyDisplayName])
}

// Sin token no hay evento. Emitirlo igual produciría un correo con un enlace vacío
// que se entrega con éxito, cuenta como enviado y deja al usuario sin forma de
// activar su cuenta — un fallo que ninguna métrica de entrega detecta.
func TestRegistrationDoesNotEmitIfTheTokenCannotBeIssued(t *testing.T) {
	t.Parallel()
	auth := &fakeAuth{issuedErr: errors.New("auth caído")}
	def := RegistrationDefinition(Clients{Auth: auth})
	st := newState(map[string]any{
		payloadUserID: testUserID, payloadEmail: "ana@fintcart.co",
	}, nil)

	produced, err := def.Steps[2].Do(context.Background(), st)
	require.Error(t, err)
	require.Nil(t, produced)
}

// ── verificación de correo (T094) ───────────────────────────────────────────

// verificationState es el estado con el que llega una verificación real: el
// `user_id` en el payload y el token FUERA de él.
func verificationState() *State {
	return newState(
		map[string]any{payloadUserID: testUserID},
		map[string]string{SecretVerificationToken: "token-del-correo"},
	)
}

// TestEmailVerificationValidatesBeforeMutating fija el ORDEN, y el orden es lo único
// que impide que un token equivocado deje huella.
//
// Auth va PRIMERO porque su paso es el que comprueba el token. Al revés, una petición
// con un token cualquiera —y el `user_id` viaja en cada evento de auditoría— marcaría
// el perfil como verificado de forma permanente antes de que nadie comprobara nada.
func TestEmailVerificationValidatesBeforeMutating(t *testing.T) {
	t.Parallel()
	auth, users := &fakeAuth{}, &fakeUsers{}
	def := EmailVerificationDefinition(Clients{Auth: auth, Users: users})
	st := verificationState()

	require.Equal(t, "auth.activate_credential", def.Steps[0].Name)
	require.Equal(t, "users.mark_email_verified", def.Steps[1].Name)

	for _, step := range def.Steps {
		_, err := step.Do(context.Background(), st)
		require.NoError(t, err)
	}
	require.Equal(t, []string{testUserID}, users.verified)
	require.Len(t, auth.activate, 1)
	// El token llega TAL CUAL a Auth: el Orquestador lo transporta y no lo interpreta
	// (Principio VI).
	require.Equal(t, "token-del-correo", auth.activate[0].GetVerificationToken())

	// Ningún paso compensa: los dos son idempotentes, y revertir la verificación
	// porque falló un evento de auditoría castigaría al usuario por un fallo de
	// infraestructura.
	for _, step := range def.Steps {
		require.Nil(t, step.Compensate, "el paso %q no debe compensar", step.Name)
	}
}

// Un token rechazado por Auth detiene la saga ANTES de tocar el perfil.
func TestEmailVerificationLeavesTheProfileAloneWhenTheTokenFails(t *testing.T) {
	t.Parallel()
	auth, users := &fakeAuth{err: errors.New("token inválido")}, &fakeUsers{}
	def := EmailVerificationDefinition(Clients{Auth: auth, Users: users})

	_, err := def.Steps[0].Do(context.Background(), verificationState())
	require.Error(t, err)
	require.Empty(t, users.verified)
}

// El token NO puede estar en el payload: `saga_state.payload` se escribe en
// PostgreSQL en cada avance, y ahí dejaría en claro lo que basta para activar la
// cuenta. Una saga reanudada se queda sin él y falla, que es el lado correcto: no hay
// efecto que deshacer y el enlace del correo sigue sirviendo.
func TestEmailVerificationFailsWhenTheSecretIsGone(t *testing.T) {
	t.Parallel()
	auth := &fakeAuth{}
	def := EmailVerificationDefinition(Clients{Auth: auth})
	resumed := newState(map[string]any{payloadUserID: testUserID}, nil)

	_, err := def.Steps[0].Do(context.Background(), resumed)
	require.ErrorIs(t, err, ErrSecretUnavailable)
	require.Empty(t, auth.activate)
}

// ── calificación (T095) ─────────────────────────────────────────────────────

func gradingState() *State {
	return newState(map[string]any{
		payloadUserID:  testUserID,
		payloadQuizID:  testQuizID,
		payloadAnswers: map[string]string{"q1": "a"},
	}, nil)
}

// TestGradingCarriesTheScoreAsAnExactDecimalString es la prueba del Principio VIII en
// esta saga: el puntaje atraviesa CUATRO fronteras —Aprendizaje, el payload, Usuarios
// y la bandeja— y en ninguna puede pasar por un tipo numérico. `85.55` en `float64`
// no es representable, y el error aparecería como una centésima perdida en la nota de
// alguien.
func TestGradingCarriesTheScoreAsAnExactDecimalString(t *testing.T) {
	t.Parallel()
	learning := &fakeLearning{resp: &learningv1.GradeResponse{
		AttemptId: "a1", AttemptNo: 2, Score: "85.55", Passed: true,
	}}
	users := &fakeUsers{points: 90}
	def := GradingDefinition(Clients{Learning: learning, Users: users})
	st := gradingState()

	for _, step := range def.Steps {
		_, err := step.Do(context.Background(), st)
		require.NoError(t, err)
	}

	require.Equal(t, "85.55", st.Payload[payloadScore])
	require.Equal(t, "85.55", users.applied.GetScore())

	// Y también en la bandeja: como CADENA JSON entrecomillada, no como número. Un
	// `"score": 85.55` lo volvería a redondear el navegador al leerlo.
	require.NotEmpty(t, users.inapp)
	require.Contains(t, users.inapp[0].GetPayloadJson(), `"score":"85.55"`)
}

// TestGradingWritesBothNotificationsUnderTheSameSagaID: las dos entradas de la bandeja
// nacen del mismo evento y comparten `event_id`. Solo el TIPO las distingue, y por eso
// Usuarios identifica una notificación por el par (`event_id`, `type`) y no por el
// `event_id` a solas — con la clave a secas, la segunda se descartaría como reentrega
// de la primera y el usuario nunca vería su hito.
func TestGradingWritesBothNotificationsUnderTheSameSagaID(t *testing.T) {
	t.Parallel()
	learning := &fakeLearning{resp: &learningv1.GradeResponse{
		AttemptId: "a1", AttemptNo: 1, Score: "95.00", Passed: true,
	}}
	users := &fakeUsers{points: 95}
	def := GradingDefinition(Clients{Learning: learning, Users: users})
	st := gradingState()

	for _, step := range def.Steps {
		_, err := step.Do(context.Background(), st)
		require.NoError(t, err)
	}

	require.Len(t, users.inapp, 2)
	kinds := []string{users.inapp[0].GetType(), users.inapp[1].GetType()}
	require.Equal(t, []string{NotifQuizResult, NotifProgressMilestone}, kinds)
	for _, n := range users.inapp {
		// El `saga_id` es lo ÚNICO estable entre reintentos del paso: el `event_id` del
		// outbox se genera de nuevo cada vez que un paso devuelve sus eventos.
		require.Equal(t, testSagaID, n.GetEventId())
		require.Equal(t, testUserID, n.GetUserId())
	}
}

// TestGradingWithoutPassingSkipsTheMilestone: el hito lo decide APRENDIZAJE con su
// `pass_threshold`. Si el Orquestador comparara el puntaje con un umbral, el umbral
// viviría aquí y sería lógica de dominio (Principio VI).
func TestGradingWithoutPassingSkipsTheMilestone(t *testing.T) {
	t.Parallel()
	learning := &fakeLearning{resp: &learningv1.GradeResponse{
		AttemptId: "a1", AttemptNo: 1, Score: "40.00", Passed: false,
	}}
	users := &fakeUsers{points: 10}
	def := GradingDefinition(Clients{Learning: learning, Users: users})
	st := gradingState()

	var produced []Event
	for _, step := range def.Steps {
		out, err := step.Do(context.Background(), st)
		require.NoError(t, err)
		produced = append(produced, out...)
	}

	// El resultado SÍ llega a la bandeja aunque suspenda: es lo que el usuario está
	// esperando ver. El hito no.
	require.Len(t, users.inapp, 1)
	require.Equal(t, NotifQuizResult, users.inapp[0].GetType())

	require.Len(t, produced, 1)
	require.Equal(t, events.EventLearningQuizGraded, produced[0].Type)
}

// TestGradingNeverCompensates es el corazón de D-07: el intento se persiste siempre
// (FR-016) y `ApplyQuizScore` es monótono, así que reintentar sustituye a deshacer.
// Una compensación que restara puntos podría dejar al usuario por debajo de donde
// estaba si su mejor puntaje venía de un intento anterior.
func TestGradingNeverCompensates(t *testing.T) {
	t.Parallel()
	for _, step := range GradingDefinition(Clients{}).Steps {
		require.Nil(t, step.Compensate, "el paso %q no debe compensar", step.Name)
	}
}

// TestGradingSurvivesAResumedPayload: tras un reinicio el payload vuelve de JSONB, así
// que el mapa de respuestas llega como `map[string]any`. Sin ese caso, las sagas
// funcionarían siempre… salvo justo después de un reinicio.
func TestGradingSurvivesAResumedPayload(t *testing.T) {
	t.Parallel()
	learning := &fakeLearning{resp: &learningv1.GradeResponse{AttemptId: "a1", Score: "50.00"}}
	def := GradingDefinition(Clients{Learning: learning, Users: &fakeUsers{}})
	st := newState(map[string]any{
		payloadUserID:  testUserID,
		payloadQuizID:  testQuizID,
		payloadAnswers: map[string]any{"q1": "a", "q2": "b"},
	}, nil)

	_, err := def.Steps[0].Do(context.Background(), st)
	require.NoError(t, err)
	require.Equal(t, map[string]string{"q1": "a", "q2": "b"}, learning.graded.GetAnswers())
}

// ── actividad (T096) ────────────────────────────────────────────────────────

// TestActivityKeepsTheNotificationBodyOutOfTheAuditEvent: el payload de la
// notificación es texto para el usuario y puede llevar datos personales; el evento va
// a Auditoría, donde el catálogo los prohíbe (FR-031).
func TestActivityKeepsTheNotificationBodyOutOfTheAuditEvent(t *testing.T) {
	t.Parallel()
	users := &fakeUsers{}
	def := ActivityDefinition(Clients{Users: users})
	st := newState(map[string]any{
		payloadUserID:    testUserID,
		payloadNotifType: "nuevo_articulo",
		payloadNotifBody: `{"titulo":"Cómo ahorrar","para":"ana@fintcart.co"}`,
	}, nil)

	_, err := def.Steps[0].Do(context.Background(), st)
	require.NoError(t, err)
	require.Len(t, users.inapp, 1)
	require.JSONEq(t, `{"titulo":"Cómo ahorrar","para":"ana@fintcart.co"}`, users.inapp[0].GetPayloadJson())

	produced, err := def.Steps[1].Do(context.Background(), st)
	require.NoError(t, err)
	require.Len(t, produced, 1)
	require.Equal(t, testUserID, produced[0].ActorRef)
	require.Equal(t, "nuevo_articulo", produced[0].Payload["activity_type"])
	require.NotContains(t, produced[0].Payload, "notification_payload")
	body, err := json.Marshal(produced[0].Payload)
	require.NoError(t, err)
	require.NotContains(t, string(body), "ana@fintcart.co")
}

func TestActivityPropagatesAFailureToWriteTheInbox(t *testing.T) {
	t.Parallel()
	users := &fakeUsers{inappErr: errors.New("usuarios no responde")}
	def := ActivityDefinition(Clients{Users: users})
	st := newState(map[string]any{
		payloadUserID: testUserID, payloadNotifType: "recordatorio", payloadNotifBody: "{}",
	}, nil)

	_, err := def.Steps[0].Do(context.Background(), st)
	require.Error(t, err)
	require.Empty(t, users.inapp)
}

// ── ayudantes del estado ────────────────────────────────────────────────────

func TestStateStringRejectsWhatIsNotAString(t *testing.T) {
	t.Parallel()
	st := newState(map[string]any{"n": 42, "vacio": ""}, nil)

	for _, key := range []string{"n", "vacio", "ausente"} {
		_, err := st.String(key)
		// Un error y no un pánico: `st.Payload[k].(string)` a pelo reventaría la
		// goroutine de la saga en lugar de compensar.
		require.ErrorIs(t, err, ErrPayloadInvalid, "clave %q", key)
	}
}

func TestStateStringMapRejectsANonStringValue(t *testing.T) {
	t.Parallel()
	st := newState(map[string]any{"m": map[string]any{"a": 1}}, nil)

	_, err := st.StringMap("m")
	require.ErrorIs(t, err, ErrPayloadInvalid)
}
