package server

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/server/steps"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Prueba de integración de la Saga de CALIFICACIÓN (T072, research D-07, FR-027).
//
// Esta saga es el caso de estudio de D-07 y el único de las cinco sin ninguna
// compensación destructiva. La razón se apoya en dos propiedades de los
// participantes, y si alguna dejara de cumplirse la saga quedaría incorrecta sin que
// nada en el Orquestador lo delatara:
//
//   - `Users.ApplyQuizScore` es MONÓTONO: guarda el puntaje solo si supera al mejor.
//     Repetirlo converge, así que el reintento sustituye a la compensación. Compensar
//     restando podría dejar al usuario por debajo de donde estaba, si su mejor puntaje
//     venía de un intento anterior.
//   - La bandeja identifica la entrada por (`event_id`, `type`), de modo que una
//     reentrega no produce una segunda notificación indistinguible.
//
// De ahí que estas pruebas no inyecten fallos de participante como las de T071, sino
// INTERRUPCIONES: se corta la escritura del avance y se reanuda la saga, que es
// exactamente el camino at-least-once que D-07 describe. Contra dobles permisivos
// todo esto pasaría igual; ver `participants_test.go`.

const (
	gradeQuizID = "77777777-7777-4777-8777-777777777777"
	gradeScore  = "85.55"
)

func newGradingEngine(store storer.Storer, users *fakeUsersSvc, learning *fakeLearningSvc) *Engine {
	return newTestEngine(store, steps.GradingDefinition(steps.Clients{
		Users: users, Learning: learning,
	}))
}

// runGrading ejecuta la saga de calificación. Es SÍNCRONA (el usuario espera su nota),
// así que no hace falta esperar a ninguna goroutine.
func runGrading(t *testing.T, engine *Engine) (QuizGrading, error) {
	t.Helper()
	return New(engine).StartQuizGrading(context.Background(), testActor, gradeQuizID,
		map[string]string{"q1": "a"})
}

// ── camino feliz ────────────────────────────────────────────────────────────

func TestGradingSagaWritesProgressInboxAndAudit(t *testing.T) {
	t.Parallel()
	store, users, learning := newMemStore(), newFakeUsers(), newFakeLearning(gradeScore, true)

	result, err := runGrading(t, newGradingEngine(store, users, learning))
	require.NoError(t, err)

	// El puntaje llega al llamante como la cadena decimal exacta que produjo
	// Aprendizaje. Es el recorrido completo del Principio VIII: cuatro fronteras y
	// ninguna conversión numérica.
	require.Equal(t, gradeScore, result.Score)
	require.True(t, result.Passed)
	require.Equal(t, int32(85), result.PointsAfter, "FLOOR(85.55) = 85")

	// Dos notificaciones de la MISMA ocurrencia: el resultado y el hito. Es lo que
	// obliga a que la identidad de la bandeja sea el par y no el `event_id` a solas.
	require.Equal(t, 2, users.inboxSize())

	// Dos eventos de auditoría, y el orden importa: la calificación antes que el hito.
	require.Len(t, store.events, 2)
	require.Equal(t, events.EventLearningQuizGraded, store.events[0].EventType)
	require.Equal(t, events.EventUserProgressMilestone, store.events[1].EventType)
}

// El puntaje viaja como cadena decimal hasta DENTRO del cuerpo de la notificación.
// Un número JSON aquí lo redondearía en el navegador, y `85.55` es exactamente el
// valor que un `double` no representa.
func TestGradingSagaKeepsTheScoreExactInTheInbox(t *testing.T) {
	t.Parallel()
	store, users, learning := newMemStore(), newFakeUsers(), newFakeLearning(gradeScore, true)
	sagaID := mustSagaID(t, store, newGradingEngine(store, users, learning))

	body, ok := users.inboxEntry(sagaID, steps.NotifQuizResult)
	require.True(t, ok, "el resultado siempre va a la bandeja (FR-023)")
	require.Equal(t, gradeScore, body["score"])
	require.Equal(t, gradeQuizID, body["quiz_id"])
}

// Suspender no es un fallo: el intento se guarda igual (FR-016) y hay notificación de
// resultado, pero NO hito. Un hito por un cuestionario suspendido sería una
// felicitación por no haberlo logrado.
func TestGradingSagaSkipsTheMilestoneWhenTheQuizIsNotPassed(t *testing.T) {
	t.Parallel()
	store, users, learning := newMemStore(), newFakeUsers(), newFakeLearning("40.00", false)

	result, err := runGrading(t, newGradingEngine(store, users, learning))
	require.NoError(t, err)
	require.False(t, result.Passed)

	require.Equal(t, 1, users.inboxSize())
	require.Len(t, store.events, 1)
	require.Equal(t, events.EventLearningQuizGraded, store.events[0].EventType)
	require.Equal(t, 1, learning.attemptCount(), "el intento se persiste aunque suspenda")
}

// ── monotonía (D-07) ────────────────────────────────────────────────────────

// TestGradingSagaHasNoCompensationAtAll es la comprobación estructural de D-07, y la
// que de verdad pertenece a este servicio.
//
// La monotonía la implementa Usuarios; lo que le toca al Orquestador es no
// contradecirla. Un paso que compensara restando dejaría al usuario por debajo de
// donde estaba cuando su mejor puntaje viniera de un intento anterior, y otro que
// borrara el intento falsificaría el historial (FR-016). Que las cuatro
// compensaciones sean `nil` es la decisión, y aquí queda fijada por construcción en
// lugar de por comentario.
func TestGradingSagaHasNoCompensationAtAll(t *testing.T) {
	t.Parallel()
	def := steps.GradingDefinition(steps.Clients{})

	require.Len(t, def.Steps, 4)
	for _, step := range def.Steps {
		require.Nil(t, step.Compensate, "el paso %q no debe compensar (D-07)", step.Name)
	}
}

// TestGradingSagaReportsTheParticipantsProgress comprueba que el progreso que sale de
// la saga es el que devolvió Usuarios, y no una cuenta propia.
//
// El escenario es el del reintento con peor nota, que es donde una aritmética local
// se delataría: un Orquestador que acumulara puntajes por su cuenta sumaría el
// segundo intento en lugar de quedarse con el mejor. Lo que se fija aquí es que
// transporta el valor del dueño del dato (Principio VI), sea cual sea.
func TestGradingSagaReportsTheParticipantsProgress(t *testing.T) {
	t.Parallel()
	store, users := newMemStore(), newFakeUsers()

	first, err := runGrading(t, newGradingEngine(store, users, newFakeLearning("90.00", true)))
	require.NoError(t, err)
	require.Equal(t, int32(90), first.PointsAfter)

	// Segundo intento, peor nota: el participante conserva el mejor y la saga reporta
	// ESO, sin sumarle ni restarle nada.
	second, err := runGrading(t, newGradingEngine(store, users, newFakeLearning("40.00", false)))
	require.NoError(t, err)
	require.Equal(t, int32(90), second.PointsAfter)
	require.Equal(t, users.points(testActor), second.PointsAfter)

	// Tercer intento, mejor nota: sube, y también viene del participante.
	third, err := runGrading(t, newGradingEngine(store, users, newFakeLearning("95.50", true)))
	require.NoError(t, err)
	require.Equal(t, int32(95), third.PointsAfter, "FLOOR(95.50) = 95")
	require.Equal(t, users.points(testActor), third.PointsAfter)
}

// ── at-least-once: la saga se interrumpe y se reanuda (FR-027) ─────────────

// TestGradingSagaResumesWithoutApplyingTheScoreTwice corta la escritura del avance
// JUSTO DESPUÉS de aplicar el puntaje.
//
// Es el escenario que hace falta cubrir porque el motor, ante un avance no
// confirmado, deliberadamente NO compensa: lo que la base recuerda es que el paso no
// se dio, así que la reanudación lo repite. Toda la corrección descansa entonces en
// que repetirlo no cambie nada.
func TestGradingSagaResumesWithoutApplyingTheScoreTwice(t *testing.T) {
	t.Parallel()
	store, users, learning := newMemStore(), newFakeUsers(), newFakeLearning("90.00", true)
	// El segundo avance es el de `users.apply_quiz_score`.
	store.advanceFail, store.advanceErr = 2, errors.New("la base se cayó al confirmar el avance")

	engine := newGradingEngine(store, users, learning)
	_, err := runGrading(t, engine)
	require.Error(t, err, "el avance no confirmado tiene que salir como error")

	// La saga sigue `running`, no `failed`: no se compensó nada y queda por reanudar.
	sagaID := onlySaga(t, store)
	require.Equal(t, storer.StatusRunning, store.row(t, sagaID).Status)

	require.NoError(t, engine.Resume(context.Background(), 10))
	require.True(t, engine.Wait(waitTimeout))

	require.Equal(t, storer.StatusCompleted, store.row(t, sagaID).Status)
	// El puntaje se aplicó DOS veces y el progreso es el mismo: eso es la monotonía.
	require.Equal(t, int32(90), users.points(testActor))
	require.Equal(t, 2, users.inboxSize(), "ni una notificación de más")
	require.Len(t, store.events, 2)
}

// TestGradingSagaResumesWithoutDuplicatingTheInbox corta el avance después de escribir
// la bandeja, que es el paso cuya repetición se vería directamente en la pantalla del
// usuario.
func TestGradingSagaResumesWithoutDuplicatingTheInbox(t *testing.T) {
	t.Parallel()
	store, users, learning := newMemStore(), newFakeUsers(), newFakeLearning(gradeScore, true)
	// El tercer avance es el de `users.append_inapp_result`.
	store.advanceFail, store.advanceErr = 3, errors.New("la base se cayó al confirmar el avance")

	engine := newGradingEngine(store, users, learning)
	_, err := runGrading(t, engine)
	require.Error(t, err)
	require.Equal(t, 2, users.inboxSize(), "las dos notificaciones ya se escribieron")

	require.NoError(t, engine.Resume(context.Background(), 10))
	require.True(t, engine.Wait(waitTimeout))

	// Se reescribieron las mismas dos claves (saga_id, tipo). Sin esa identidad, el
	// usuario vería su resultado y su hito por duplicado en la bandeja.
	require.Equal(t, 2, users.inboxSize())
	require.Equal(t, storer.StatusCompleted, store.row(t, onlySaga(t, store)).Status)
}

// TestGradingSagaRetriesTheGradingStepWithTheSameIdempotencyKey corta el avance
// JUSTO DESPUÉS de que `Learning.GradeAndStoreAttempt` tuvo éxito — el primer avance,
// antes de que `TestGradingSagaResumesWithoutApplyingTheScoreTwice` empiece a
// interesarse por lo que pasa más adelante. Sin una clave de idempotencia ESTABLE
// entre las dos llamadas, ese reintento dejaría un intento FANTASMA en el historial
// del usuario (T176, SC-008, FR-016) — el mismo defecto que
// `TestSimulationSagaRetriesTheComputeStepWithTheSameIdempotencyKey` corrigió del
// lado del Simulador. Lo que se comprueba aquí es la mitad que le toca al
// Orquestador; la otra mitad —que Aprendizaje de verdad dedupe por esa clave— la
// cubre `quizzes.repository.spec.ts`.
func TestGradingSagaRetriesTheGradingStepWithTheSameIdempotencyKey(t *testing.T) {
	t.Parallel()
	store, users, learning := newMemStore(), newFakeUsers(), newFakeLearning(gradeScore, true)
	store.advanceFail, store.advanceErr = 1, errors.New("la base se cayó al confirmar el avance")

	engine := newGradingEngine(store, users, learning)
	_, err := runGrading(t, engine)
	require.Error(t, err, "el avance no confirmado tiene que salir como error")
	require.Equal(t, storer.StatusRunning, store.row(t, onlySaga(t, store)).Status)

	require.NoError(t, engine.Resume(context.Background(), 10))
	require.True(t, engine.Wait(waitTimeout))

	require.Equal(t, storer.StatusCompleted, store.row(t, onlySaga(t, store)).Status)
	require.Len(t, learning.requests, 2, "Do se repitió: el primer intento no llegó a confirmarse")
	require.NotEmpty(t, learning.requests[0].GetIdempotencyKey())
	require.Equal(t, learning.requests[0].GetIdempotencyKey(), learning.requests[1].GetIdempotencyKey(),
		"las dos llamadas deben identificarse como el MISMO intento ante Aprendizaje")
}

// TestGradingSagaNeverErasesTheAttempt: el primer paso no tiene compensación, y eso es
// una decisión, no un olvido.
//
// El historial de intentos es completo por FR-016, así que «deshacer» un intento sería
// falsificarlo. Aquí falla un paso POSTERIOR y el intento tiene que seguir contado.
func TestGradingSagaNeverErasesTheAttempt(t *testing.T) {
	t.Parallel()
	store, users, learning := newMemStore(), newFakeUsers(), newFakeLearning(gradeScore, true)
	users.fail["ApplyQuizScore"] = errors.New("usuarios caído")

	_, err := runGrading(t, newGradingEngine(store, users, learning))
	require.Error(t, err)

	require.Equal(t, 1, learning.attemptCount(), "el intento calificado permanece en el historial")
	require.Zero(t, users.inboxSize())
	require.Empty(t, store.events, "sin puntaje aplicado no se audita ninguna calificación")
	require.Equal(t, storer.StatusFailed, store.row(t, onlySaga(t, store)).Status)
}

// ── ayudantes ───────────────────────────────────────────────────────────────

// onlySaga devuelve el identificador de la única saga registrada.
//
// Estas pruebas arrancan una sola, y pedir el id por aquí evita tener que propagarlo
// desde dentro de un flujo que devuelve el resultado del cuestionario, no un handle.
func onlySaga(t *testing.T, store *memStore) uuid.UUID {
	t.Helper()
	store.mu.Lock()
	defer store.mu.Unlock()

	require.Len(t, store.sagas, 1, "se esperaba exactamente una saga")
	for id := range store.sagas {
		return id
	}
	return uuid.Nil
}

// mustSagaID ejecuta la saga y devuelve su identificador, que es la clave con la que
// la bandeja indexa sus entradas.
func mustSagaID(t *testing.T, store *memStore, engine *Engine) string {
	t.Helper()
	_, err := runGrading(t, engine)
	require.NoError(t, err)
	return onlySaga(t, store).String()
}
