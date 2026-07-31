package outbox

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Pruebas del publicador del outbox transaccional (D-07).
//
// Todas giran alrededor de la misma pregunta: ¿qué le pasa a un evento cuando algo
// falla? La respuesta correcta nunca es «se pierde». Un evento perdido es un correo
// que no se envía o un registro de auditoría que no existe, y `audit_log` es
// append-only, así que el hueco no se puede rellenar después.
//
// §Calidad: sin broker ni base de datos.

// ── dobles ─────────────────────────────────────────────────────────────────

// fakeStore recuerda qué se marcó y qué se contó como fallo.
type fakeStore struct {
	pending   []storer.OutboxRow
	published []uuid.UUID
	attempts  map[uuid.UUID]int
	causes    map[uuid.UUID]string

	markErr error
}

func newFakeStore(rows ...storer.OutboxRow) *fakeStore {
	return &fakeStore{
		pending:  rows,
		attempts: map[uuid.UUID]int{},
		causes:   map[uuid.UUID]string{},
	}
}

func (f *fakeStore) ListPendingEvents(context.Context, int32) ([]storer.OutboxRow, error) {
	return f.pending, nil
}

func (f *fakeStore) MarkEventPublished(_ context.Context, id uuid.UUID) error {
	if f.markErr != nil {
		return f.markErr
	}
	f.published = append(f.published, id)
	return nil
}

func (f *fakeStore) IncrementEventAttempts(_ context.Context, id uuid.UUID, cause error) error {
	f.attempts[id]++
	if cause != nil {
		f.causes[id] = cause.Error()
	}
	return nil
}

// fakePublisher apunta el orden de entrega y puede fallar en una routing key.
type fakePublisher struct {
	delivered []string
	bodies    [][]byte
	failOnKey string
}

var errBrokerDown = errors.New("el broker no responde")

func (f *fakePublisher) Publish(_ context.Context, _, routingKey string, body []byte) error {
	if routingKey == f.failOnKey {
		return errBrokerDown
	}
	f.delivered = append(f.delivered, routingKey)
	f.bodies = append(f.bodies, body)
	return nil
}

func newTestRelay(store Store, pub Publisher) *Relay {
	return NewRelay(store, pub, slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		Exchange:  "fintcart.events",
		BatchSize: 10,
		Interval:  time.Millisecond,
	})
}

func row(eventType string, body string) storer.OutboxRow {
	return storer.OutboxRow{
		ID:         uuid.New(),
		EventType:  eventType,
		RoutingKey: eventType,
		Payload:    []byte(body),
	}
}

// ── pruebas ────────────────────────────────────────────────────────────────

func TestPublishesAndSealsEveryPendingEvent(t *testing.T) {
	t.Parallel()
	a, b := row("user.registered", `{"event_id":"1"}`), row("user.email_verified", `{"event_id":"2"}`)
	store := newFakeStore(a, b)
	pub := &fakePublisher{}

	require.NoError(t, newTestRelay(store, pub).drainOnce(context.Background()))
	require.Equal(t, []string{"user.registered", "user.email_verified"}, pub.delivered)
	require.Equal(t, []uuid.UUID{a.ID, b.ID}, store.published)
}

// TestBodyIsForwardedVerbatim: el sobre lo construyó el motor dentro de la
// transacción de la saga. Si el relay lo rearmara, el `event_id` o el `occurred_at`
// podrían diferir entre el primer intento y el reintento, y la idempotencia por
// `event_id` de los consumidores dejaría de proteger de nada.
func TestBodyIsForwardedVerbatim(t *testing.T) {
	t.Parallel()
	const sobre = `{"event_id":"abc","event_type":"user.registered","payload":{"score":"85.55"}}`
	store := newFakeStore(row("user.registered", sobre))
	pub := &fakePublisher{}

	require.NoError(t, newTestRelay(store, pub).drainOnce(context.Background()))
	require.Equal(t, sobre, string(pub.bodies[0]))
}

// TestOrderIsPreservedAndAFailureStopsTheBatch.
//
// Los eventos salen en el orden de `created_at` y en serie. Saltar al siguiente tras
// un fallo publicaría el posterior antes que el anterior, y Auditoría registraría una
// secuencia que no ocurrió —una cuenta anonimizada antes de haberse registrado— en
// una tabla append-only donde esa contradicción ya no se puede corregir.
func TestOrderIsPreservedAndAFailureStopsTheBatch(t *testing.T) {
	t.Parallel()
	primero := row("user.registered", `{}`)
	falla := row("user.email_verified", `{}`)
	posterior := row("account.anonymized", `{}`)
	store := newFakeStore(primero, falla, posterior)
	pub := &fakePublisher{failOnKey: "user.email_verified"}

	err := newTestRelay(store, pub).drainOnce(context.Background())
	require.ErrorIs(t, err, ErrPublishFailed)
	require.ErrorIs(t, err, errBrokerDown)

	require.Equal(t, []string{"user.registered"}, pub.delivered)
	require.NotContains(t, store.published, posterior.ID, "no se adelanta al que falló")
}

// TestTheEventSurvivesAFailedPublish: lo importante de un fallo de publicación es lo
// que NO pasa — el evento no se sella, así que sigue pendiente y el siguiente barrido
// lo reintenta.
func TestTheEventSurvivesAFailedPublish(t *testing.T) {
	t.Parallel()
	ev := row("user.registered", `{}`)
	store := newFakeStore(ev)
	pub := &fakePublisher{failOnKey: "user.registered"}

	require.Error(t, newTestRelay(store, pub).drainOnce(context.Background()))
	require.Empty(t, store.published)
	require.Equal(t, 1, store.attempts[ev.ID])
	require.Contains(t, store.causes[ev.ID], errBrokerDown.Error(),
		"la causa se guarda en la fila: un contador sin motivo no dice si conviene reintentar")
}

// TestAFailedSealMeansAtLeastOnce: el evento ya salió hacia el broker y no se pudo
// sellar, así que el próximo barrido lo publicará otra vez. Es la contrapartida
// ASUMIDA de D-07 y la razón de que los consumidores deban ser idempotentes por
// `event_id`. Sellar ANTES de publicar cambiaría este duplicado por una pérdida
// silenciosa, que es mucho peor.
func TestAFailedSealMeansAtLeastOnce(t *testing.T) {
	t.Parallel()
	store := newFakeStore(row("user.registered", `{}`))
	store.markErr = errors.New("la base no confirmó el sellado")
	pub := &fakePublisher{}

	require.Error(t, newTestRelay(store, pub).drainOnce(context.Background()))
	require.Len(t, pub.delivered, 1, "el evento sí llegó al broker")
	require.Empty(t, store.published)
}

// TestRunStopsOnCancellationWithoutError: la cancelación es el apagado ordenado, no
// un fallo. Devolver error haría que cada `dev/down` dejara un log de error espurio.
func TestRunStopsOnCancellationWithoutError(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	require.NoError(t, newTestRelay(newFakeStore(), &fakePublisher{}).Run(ctx))
}

// TestABadBatchDoesNotStopTheRelay: un hipo del broker no puede convertirse en la
// parada permanente de toda la publicación. El barrido falla, se registra, y el
// siguiente ciclo vuelve a intentarlo.
func TestABadBatchDoesNotStopTheRelay(t *testing.T) {
	t.Parallel()
	store := newFakeStore(row("user.registered", `{}`))
	pub := &fakePublisher{failOnKey: "user.registered"}
	relay := newTestRelay(store, pub)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	require.NoError(t, relay.Run(ctx), "el relay sobrevive a barridos fallidos")
	require.GreaterOrEqual(t, store.attempts[store.pending[0].ID], 1)
}
