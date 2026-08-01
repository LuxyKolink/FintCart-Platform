package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/server/steps"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Pruebas del motor de sagas.
//
// Lo que se prueba aquí NO es que una saga feliz llegue al final: eso lo haría
// cualquier bucle. Lo que hay que comprobar de un motor de sagas es el camino de
// FALLO —qué se deshace, en qué orden, y qué ocurre si el proceso muere en mitad de
// deshacerlo—, porque es el camino que casi nunca se recorre en producción y el único
// que justifica que el motor exista (Principio VI).
//
// Las definiciones son sintéticas y sin dominio, igual que el motor: pasos que apuntan
// lo que hicieron en una lista. Usar las definiciones reales mezclaría el fallo del
// motor con el de un participante.
//
// §Calidad: sin PostgreSQL. El storer en memoria replica el bloqueo optimista del
// real, que es la única de sus propiedades de la que depende el motor.

// ── doble de persistencia ───────────────────────────────────────────────────

// memStore replica `storer.Storer` en memoria, incluido el bloqueo optimista.
type memStore struct {
	mu     sync.Mutex
	sagas  map[uuid.UUID]*storer.SagaRow
	events []storer.OutboxRow

	// advanceErr, si no es nil, se devuelve en el enésimo `AdvanceSaga`.
	advanceErr  error
	advanceFail int
	advances    int
}

func newMemStore() *memStore {
	return &memStore{sagas: map[uuid.UUID]*storer.SagaRow{}, advanceFail: -1}
}

func (m *memStore) CreateSaga(_ context.Context, sagaType string, payload []byte) (uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	id := uuid.New()
	m.sagas[id] = &storer.SagaRow{
		ID: id, SagaType: sagaType, Status: storer.StatusRunning,
		CurrentStep: 0, Payload: payload, Compensations: []byte(`[]`),
	}
	return id, nil
}

func (m *memStore) GetSaga(_ context.Context, sagaID uuid.UUID) (storer.SagaRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	row, ok := m.sagas[sagaID]
	if !ok {
		return storer.SagaRow{}, storer.ErrNotFound
	}
	return *row, nil
}

func (m *memStore) AdvanceSaga(
	_ context.Context,
	sagaID uuid.UUID,
	fromStep, toStep int32,
	payload, compensations []byte,
	evs []storer.OutboxRow,
) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.advances++
	if m.advanceFail >= 0 && m.advances == m.advanceFail {
		return m.advanceErr
	}

	row, ok := m.sagas[sagaID]
	if !ok {
		return storer.ErrNotFound
	}
	// El bloqueo optimista del real: si la fila ya no está en `fromStep`, la
	// escritura no aplica. Es la propiedad de la que depende que dos ejecuciones de
	// la misma saga no avancen el paso dos veces.
	if row.CurrentStep != fromStep {
		return storer.ErrConflict
	}

	row.CurrentStep = toStep
	row.Payload = payload
	row.Compensations = compensations
	m.events = append(m.events, evs...)
	return nil
}

func (m *memStore) MarkStatus(_ context.Context, sagaID uuid.UUID, status string, lastErr error) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	row, ok := m.sagas[sagaID]
	if !ok {
		return storer.ErrNotFound
	}
	row.Status = status
	if lastErr != nil {
		msg := lastErr.Error()
		row.LastError = &msg
	}
	return nil
}

func (m *memStore) ListResumable(_ context.Context, limit int32) ([]storer.SagaRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var out []storer.SagaRow
	for _, row := range m.sagas {
		if len(out) >= int(limit) {
			break
		}
		if row.Status == storer.StatusRunning || row.Status == storer.StatusCompensating {
			out = append(out, *row)
		}
	}
	return out, nil
}

func (m *memStore) ListPendingEvents(context.Context, int32) ([]storer.OutboxRow, error) {
	return nil, nil
}
func (m *memStore) MarkEventPublished(context.Context, uuid.UUID) error            { return nil }
func (m *memStore) IncrementEventAttempts(context.Context, uuid.UUID, error) error { return nil }

// status devuelve el estado actual de la única saga registrada.
func (m *memStore) row(t *testing.T, id uuid.UUID) storer.SagaRow {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.sagas[id]
	require.True(t, ok, "la saga %s no existe", id)
	return *row
}

// ── definiciones sintéticas ────────────────────────────────────────────────

const testSagaType = storer.SagaRegistro

// tracker apunta el orden en que se ejecutan pasos y compensaciones.
type tracker struct {
	mu    sync.Mutex
	calls []string
}

func (tr *tracker) add(entry string) {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	tr.calls = append(tr.calls, entry)
}

func (tr *tracker) seen() []string {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	return append([]string(nil), tr.calls...)
}

// okStep construye un paso que solo apunta su paso por el tracker.
func okStep(tr *tracker, name string) steps.Step {
	return steps.Step{
		Name: name,
		Do: func(_ context.Context, st *steps.State) ([]steps.Event, error) {
			tr.add("do:" + name)
			st.Payload[name] = "hecho"
			return nil, nil
		},
		Compensate: func(context.Context, *steps.State) error {
			tr.add("undo:" + name)
			return nil
		},
	}
}

var errStepFailed = errors.New("el participante rechazó la operación")

// failingStep construye un paso que siempre falla.
func failingStep(tr *tracker, name string) steps.Step {
	return steps.Step{
		Name: name,
		Do: func(context.Context, *steps.State) ([]steps.Event, error) {
			tr.add("do:" + name)
			return nil, errStepFailed
		},
		Compensate: func(context.Context, *steps.State) error {
			tr.add("undo:" + name)
			return nil
		},
	}
}

func newTestEngine(store storer.Storer, def steps.Definition) *Engine {
	return NewEngine(store, slog.New(slog.NewTextHandler(io.Discard, nil)), def)
}

// ── camino feliz ───────────────────────────────────────────────────────────

func TestSagaCompletesAndRecordsEveryStep(t *testing.T) {
	t.Parallel()
	tr := &tracker{}
	store := newMemStore()
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{
		okStep(tr, "uno"), okStep(tr, "dos"), okStep(tr, "tres"),
	}}

	payload, err := newTestEngine(store, def).Execute(context.Background(), testSagaType, map[string]any{"email": "a@b.co"}, nil)
	require.NoError(t, err)
	require.Equal(t, []string{"do:uno", "do:dos", "do:tres"}, tr.seen())
	// El payload que un paso escribe llega al siguiente y sale por el resultado: es
	// lo único que los pasos comparten entre sí.
	require.Equal(t, "hecho", payload["uno"])
	require.Equal(t, "a@b.co", payload["email"])

	for id := range store.sagas {
		row := store.row(t, id)
		require.Equal(t, storer.StatusCompleted, row.Status)
		require.Equal(t, int32(3), row.CurrentStep)
	}
}

// TestEveryStepIsPersistedBeforeTheNext: el avance se escribe paso a paso y no al
// final. Con una sola escritura al terminar, un reinicio a mitad de saga dejaría la
// fila en el paso 0 y la reanudación repetiría pasos ya aplicados.
func TestEveryStepIsPersistedBeforeTheNext(t *testing.T) {
	t.Parallel()
	tr := &tracker{}
	store := newMemStore()
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{
		okStep(tr, "uno"), okStep(tr, "dos"),
	}}

	_, err := newTestEngine(store, def).Execute(context.Background(), testSagaType, nil, nil)
	require.NoError(t, err)
	require.Equal(t, 2, store.advances, "debe haber una escritura por paso")
}

// ── compensación ───────────────────────────────────────────────────────────

// TestFailureCompensatesInReverseOrder es la prueba central del motor.
//
// Deshacer en el mismo orden en que se hizo puede violar dependencias entre pasos:
// anonimizar la credencial antes de revocar las sesiones abre justo la ventana que la
// saga quería cerrar.
func TestFailureCompensatesInReverseOrder(t *testing.T) {
	t.Parallel()
	tr := &tracker{}
	store := newMemStore()
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{
		okStep(tr, "uno"), okStep(tr, "dos"), failingStep(tr, "tres"),
	}}

	_, err := newTestEngine(store, def).Execute(context.Background(), testSagaType, nil, nil)
	require.ErrorIs(t, err, ErrSagaFailed)
	require.ErrorIs(t, err, errStepFailed, "la causa original debe seguir accesible")

	require.Equal(t, []string{
		"do:uno", "do:dos", "do:tres",
		"undo:dos", "undo:uno",
	}, tr.seen())

	for id := range store.sagas {
		row := store.row(t, id)
		require.Equal(t, storer.StatusFailed, row.Status)
		// El puntero vuelve a cero: no queda nada aplicado que deshacer.
		require.Equal(t, int32(0), row.CurrentStep)
		require.NotNil(t, row.LastError)
	}
}

// TestTheFailingStepIsNotCompensated: el paso que falló no llegó a aplicarse, así que
// deshacerlo sería deshacer algo que nunca ocurrió — y una compensación no siempre es
// inocua cuando su paso no se dio.
func TestTheFailingStepIsNotCompensated(t *testing.T) {
	t.Parallel()
	tr := &tracker{}
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{
		okStep(tr, "uno"), failingStep(tr, "dos"),
	}}

	_, err := newTestEngine(newMemStore(), def).Execute(context.Background(), testSagaType, nil, nil)
	require.Error(t, err)
	require.NotContains(t, tr.seen(), "undo:dos")
	require.Contains(t, tr.seen(), "undo:uno")
}

// TestStepsWithoutCompensationAreSkipped: `Compensate: nil` es información, no un
// descuido. Un paso que solo lee, o una escritura idempotente y monótona como
// `Users.ApplyQuizScore` (D-07), no deja efecto que deshacer.
func TestStepsWithoutCompensationAreSkipped(t *testing.T) {
	t.Parallel()
	tr := &tracker{}
	sinCompensacion := steps.Step{
		Name: "solo_lectura",
		Do: func(context.Context, *steps.State) ([]steps.Event, error) {
			tr.add("do:solo_lectura")
			return nil, nil
		},
		Compensate: nil,
	}
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{
		okStep(tr, "uno"), sinCompensacion, failingStep(tr, "tres"),
	}}

	_, err := newTestEngine(newMemStore(), def).Execute(context.Background(), testSagaType, nil, nil)
	require.Error(t, err)
	require.Equal(t, []string{
		"do:uno", "do:solo_lectura", "do:tres", "undo:uno",
	}, tr.seen())
}

// TestCompensationSurvivesTheCallersCancellation: la causa más común de que un paso
// falle es que el contexto se cancelara. Si la compensación heredara ese contexto,
// fallaría en la primera llamada y la saga quedaría a medias justo en el escenario
// para el que existe.
func TestCompensationSurvivesTheCallersCancellation(t *testing.T) {
	t.Parallel()
	tr := &tracker{}

	ctx, cancel := context.WithCancel(context.Background())
	pasoQueCancela := steps.Step{
		Name: "cancela",
		Do: func(context.Context, *steps.State) ([]steps.Event, error) {
			cancel()
			return nil, context.Canceled
		},
	}
	var compensationCtxErr error
	primero := steps.Step{
		Name: "primero",
		Do:   func(context.Context, *steps.State) ([]steps.Event, error) { return nil, nil },
		Compensate: func(cctx context.Context, _ *steps.State) error {
			compensationCtxErr = cctx.Err()
			tr.add("undo:primero")
			return nil
		},
	}
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{primero, pasoQueCancela}}

	_, err := newTestEngine(newMemStore(), def).Execute(ctx, testSagaType, nil, nil)
	require.Error(t, err)
	require.Equal(t, []string{"undo:primero"}, tr.seen())
	require.NoError(t, compensationCtxErr, "la compensación no puede heredar la cancelación")
}

// TestFailedCompensationLeavesTheSagaRetryable: una compensación pendiente no se puede
// dar por perdida. La saga se queda en `compensating` —no en `failed`— porque solo ese
// estado vuelve a intentarse en el barrido de reanudación.
func TestFailedCompensationLeavesTheSagaRetryable(t *testing.T) {
	t.Parallel()
	errUndo := errors.New("el participante no pudo deshacer")
	rompeAlDeshacer := steps.Step{
		Name:       "rompe",
		Do:         func(context.Context, *steps.State) ([]steps.Event, error) { return nil, nil },
		Compensate: func(context.Context, *steps.State) error { return errUndo },
	}
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{
		rompeAlDeshacer, failingStep(&tracker{}, "falla"),
	}}

	store := newMemStore()
	_, err := newTestEngine(store, def).Execute(context.Background(), testSagaType, nil, nil)
	require.ErrorIs(t, err, errUndo)

	for id := range store.sagas {
		require.Equal(t, storer.StatusCompensating, store.row(t, id).Status)
	}
}

// ── concurrencia y reanudación ─────────────────────────────────────────────

// TestConflictStopsWithoutCompensating: si otra ejecución de la misma saga se
// adelantó, esta se retira. Compensar aquí desharía pasos que la otra está usando.
func TestConflictStopsWithoutCompensating(t *testing.T) {
	t.Parallel()
	tr := &tracker{}
	store := newMemStore()
	store.advanceFail, store.advanceErr = 1, storer.ErrConflict
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{okStep(tr, "uno"), okStep(tr, "dos")}}

	_, err := newTestEngine(store, def).Execute(context.Background(), testSagaType, nil, nil)
	require.ErrorIs(t, err, storer.ErrConflict)
	require.Equal(t, []string{"do:uno"}, tr.seen(), "no se compensa lo que la base no registró")
}

func TestResumeContinuesFromTheRecordedStep(t *testing.T) {
	t.Parallel()
	tr := &tracker{}
	store := newMemStore()
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{
		okStep(tr, "uno"), okStep(tr, "dos"), okStep(tr, "tres"),
	}}

	// Una saga que quedó tras el primer paso: `current_step` y la lista de pasos
	// completados deben cuadrar, que es el invariante del motor.
	id, err := store.CreateSaga(context.Background(), testSagaType, []byte(`{}`))
	require.NoError(t, err)
	row := store.sagas[id]
	row.CurrentStep = 1
	row.Compensations = []byte(`["uno"]`)

	engine := newTestEngine(store, def)
	require.NoError(t, engine.Resume(context.Background(), 10))
	require.True(t, engine.Wait(5*time.Second))

	require.Equal(t, []string{"do:dos", "do:tres"}, tr.seen(), "el paso ya aplicado no se repite")
	require.Equal(t, storer.StatusCompleted, store.row(t, id).Status)
}

// TestResumeOfACompensatingSagaUndoesInsteadOfAdvancing: `compensating` es un estado
// propio y no un `failed` temprano precisamente por esto — una saga que murió
// deshaciendo tiene que TERMINAR de deshacer, no volver a avanzar.
func TestResumeOfACompensatingSagaUndoesInsteadOfAdvancing(t *testing.T) {
	t.Parallel()
	tr := &tracker{}
	store := newMemStore()
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{
		okStep(tr, "uno"), okStep(tr, "dos"), okStep(tr, "tres"),
	}}

	id, err := store.CreateSaga(context.Background(), testSagaType, []byte(`{}`))
	require.NoError(t, err)
	row := store.sagas[id]
	row.Status = storer.StatusCompensating
	row.CurrentStep = 2
	row.Compensations = []byte(`["uno","dos"]`)

	engine := newTestEngine(store, def)
	require.NoError(t, engine.Resume(context.Background(), 10))
	require.True(t, engine.Wait(5*time.Second))

	require.Equal(t, []string{"undo:dos", "undo:uno"}, tr.seen())
	require.Equal(t, storer.StatusFailed, store.row(t, id).Status)
}

// TestInconsistentRowIsNotExecuted: si `current_step` y los pasos registrados no
// cuadran, no se sabe qué paso corresponde a qué nombre. Deshacer a ciegas es peor
// que detenerse.
func TestInconsistentRowIsNotExecuted(t *testing.T) {
	t.Parallel()
	tr := &tracker{}
	store := newMemStore()
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{okStep(tr, "uno"), okStep(tr, "dos")}}

	id, err := store.CreateSaga(context.Background(), testSagaType, []byte(`{}`))
	require.NoError(t, err)
	store.sagas[id].CurrentStep = 2 // pero `compensations` sigue vacío

	engine := newTestEngine(store, def)
	require.NoError(t, engine.Resume(context.Background(), 10))
	require.True(t, engine.Wait(5*time.Second))

	require.Empty(t, tr.seen(), "no se ejecuta nada sobre un estado ilegible")
	require.Equal(t, storer.StatusFailed, store.row(t, id).Status)
}

func TestUnknownSagaTypeIsRejected(t *testing.T) {
	t.Parallel()
	def := steps.Definition{Type: testSagaType}
	_, err := newTestEngine(newMemStore(), def).Execute(context.Background(), "inexistente", nil, nil)
	require.ErrorIs(t, err, ErrUnknownSagaType)
}

// ── eventos ────────────────────────────────────────────────────────────────

const testActor = "11111111-1111-4111-8111-111111111111"

// emitStep construye un paso que produce un evento.
func emitStep(name, actorRef string) steps.Step {
	return steps.Step{
		Name: name,
		Do: func(context.Context, *steps.State) ([]steps.Event, error) {
			return []steps.Event{{
				Type:     events.EventUserRegistered,
				ActorRef: actorRef,
				Payload:  map[string]any{"email": "a@b.co"},
			}}, nil
		},
	}
}

// TestEventCarriesTheCatalogEnvelope: el sobre lo construye el MOTOR y se guarda
// entero en el outbox, de modo que el relay publica exactamente los mismos bytes en
// cada reintento. Si el relay lo rearmara, el `event_id` cambiaría entre intentos y la
// idempotencia por `event_id` de los consumidores dejaría de servir para nada.
func TestEventCarriesTheCatalogEnvelope(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{emitStep("emite", testActor)}}

	_, err := newTestEngine(store, def).Execute(context.Background(), testSagaType, nil, nil)
	require.NoError(t, err)
	require.Len(t, store.events, 1)

	row := store.events[0]
	require.Equal(t, events.EventUserRegistered, row.EventType)
	require.Equal(t, events.EventUserRegistered, row.RoutingKey, "la routing key cae al event_type")

	var env events.Envelope
	require.NoError(t, json.Unmarshal(row.Payload, &env))
	require.Equal(t, row.ID.String(), env.EventID, "el event_id del sobre ES el id de la fila")
	require.Equal(t, testActor, env.ActorRef)
	require.Equal(t, "a@b.co", env.Payload["email"])
	_, err = time.Parse(time.RFC3339, env.OccurredAt)
	require.NoError(t, err, "occurred_at debe ser RFC-3339 o Auditoría lo manda a la dead-letter")
}

// TestEventWithoutValidActorIsRejectedBeforeTheOutbox: Auditoría descarta a la
// dead-letter todo sobre cuyo `actor_ref` no sea un UUID. Detectarlo aquí convierte un
// registro perdido a tres saltos del origen en un fallo de la saga que lo produjo.
func TestEventWithoutValidActorIsRejectedBeforeTheOutbox(t *testing.T) {
	t.Parallel()
	store := newMemStore()

	for _, actor := range []string{"", "no-es-un-uuid"} {
		def := steps.Definition{Type: testSagaType, Steps: []steps.Step{emitStep("emite", actor)}}
		_, err := newTestEngine(store, def).Execute(context.Background(), testSagaType, nil, nil)
		require.ErrorIs(t, err, ErrInvalidEvent, "actor_ref %q", actor)
	}
	require.Empty(t, store.events, "un evento inválido no puede llegar al outbox")
}

// TestEventsAreWrittenWithTheAdvance: la garantía de D-07. El evento y el avance van
// en la misma escritura, así que un avance confirmado tiene siempre su evento
// registrado — no hay ventana en la que la saga progrese y el evento se pierda.
func TestEventsAreWrittenWithTheAdvance(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	store.advanceFail, store.advanceErr = 1, errors.New("la base falló al confirmar")
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{emitStep("emite", testActor)}}

	_, err := newTestEngine(store, def).Execute(context.Background(), testSagaType, nil, nil)
	require.Error(t, err)
	require.Empty(t, store.events, "sin avance confirmado no puede quedar evento encolado")
}

// ── secretos de saga ────────────────────────────────────────────────────────

// TestStartRegistrationNeverPersistsThePassword es una prueba de SEGURIDAD, no de
// funcionalidad.
//
// `saga_state.payload` se escribe en PostgreSQL en cada avance de la saga, así que
// una contraseña metida ahí queda en claro en la base y en cada copia de seguridad
// hasta que alguien limpie la fila. La constitución lo prohíbe, y no hay cifrado de
// columna que lo arregle: la clave viviría en el mismo despliegue.
//
// La comprobación es sobre los BYTES que llegaron al almacén y no sobre el mapa que
// construye `StartRegistration`: es lo único que demuestra que el valor no cruzó la
// frontera, y sigue valiendo si alguien añade otro campo al payload más adelante.
func TestStartRegistrationNeverPersistsThePassword(t *testing.T) {
	t.Parallel()
	const password = "una-contraseña-muy-secreta-123"

	store := newMemStore()
	tr := &tracker{}
	// La definición es sintética: lo que se prueba es qué se PERSISTE al arrancar,
	// no qué hacen los participantes.
	def := steps.Definition{Type: storer.SagaRegistro, Steps: []steps.Step{okStep(tr, "uno")}}
	svc := New(newTestEngine(store, def))

	id, err := svc.StartRegistration(context.Background(), "ana@fintcart.co", password, "Ana")
	require.NoError(t, err)

	sagaID, err := uuid.Parse(id)
	require.NoError(t, err)
	row := store.row(t, sagaID)
	require.NotContains(t, string(row.Payload), password)

	// Y lo que sí tiene que estar: el `user_id` asignado al crear la saga. Generarlo
	// dentro del primer paso haría que un reintento produjera otro identificador y,
	// con él, una segunda credencial que nadie compensaría.
	var payload map[string]any
	require.NoError(t, json.Unmarshal(row.Payload, &payload))
	require.NotEmpty(t, payload["user_id"])
	_, err = uuid.Parse(payload["user_id"].(string))
	require.NoError(t, err)
	require.Equal(t, "ana@fintcart.co", payload["email"])
}

// TestResumedSagasHaveNoSecrets: los secretos no sobreviven a un reinicio, por
// construcción. Un paso que los necesite falla y la saga compensa, en vez de
// continuar con un valor vacío — que en el registro sería una credencial con
// contraseña en blanco.
func TestResumedSagasHaveNoSecrets(t *testing.T) {
	t.Parallel()
	var seen *steps.State
	store := newMemStore()
	def := steps.Definition{Type: testSagaType, Steps: []steps.Step{{
		Name: "mira",
		Do: func(_ context.Context, st *steps.State) ([]steps.Event, error) {
			seen = st
			return nil, nil
		},
	}}}
	engine := newTestEngine(store, def)

	_, err := engine.Start(context.Background(), testSagaType,
		map[string]any{"user_id": uuid.NewString()},
		map[string]string{steps.SecretPassword: "en-memoria"})
	require.NoError(t, err)
	require.True(t, engine.Wait(2*time.Second))
	require.NotNil(t, seen)
	require.Equal(t, "en-memoria", seen.Secrets[steps.SecretPassword])

	// Ahora el mismo motor reanuda: el proceso «murió» y con él los secretos.
	seen = nil
	store.mu.Lock()
	for _, row := range store.sagas {
		row.Status = storer.StatusRunning
		row.CurrentStep = 0
		row.Compensations = []byte(`[]`)
	}
	store.mu.Unlock()

	require.NoError(t, engine.Resume(context.Background(), 10))
	require.True(t, engine.Wait(2*time.Second))
	require.NotNil(t, seen)
	require.Empty(t, seen.Secrets)
}
