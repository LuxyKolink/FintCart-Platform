package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/stretchr/testify/require"

	"github.com/fintcart/platform/services/audit/internal/storer"
)

// Pruebas del consumidor de Auditoría.
//
// Lo que se comprueba aquí es el DESTINO de cada mensaje, porque las tres salidas no
// son intercambiables y confundir dos de ellas destruye información que no se puede
// recuperar:
//
//	evento mal formado  → dead-letter   (no va a mejorar reintentándolo)
//	fallo de escritura  → reintento     (fue la base, no el mensaje)
//	éxito               → ack           (después del INSERT, nunca antes)
//
// El error caro es el segundo tratado como el primero: un hipo de la base mandaría a
// la dead-letter un registro de auditoría, y `audit_log` es la fuente autoritativa de
// trazabilidad regulatoria (FR-025) — un hueco ahí no se rellena después.
//
// §Calidad: sin broker ni PostgreSQL.

// ── dobles ─────────────────────────────────────────────────────────────────

// acks apunta cómo se confirmó cada mensaje.
type acks struct {
	acked    []uint64
	nacked   []uint64
	requeued []bool
}

func (a *acks) Ack(tag uint64, _ bool) error {
	a.acked = append(a.acked, tag)
	return nil
}

func (a *acks) Nack(tag uint64, _, requeue bool) error {
	a.nacked = append(a.nacked, tag)
	a.requeued = append(a.requeued, requeue)
	return nil
}

func (a *acks) Reject(tag uint64, requeue bool) error {
	return a.Nack(tag, false, requeue)
}

// fakeStore recuerda lo que se insertó y puede fallar a voluntad.
//
// Deduplica por `id` igual que el `ON CONFLICT (id, occurred_at) DO NOTHING` real
// (`storer_postgres.go`): sin esto, una prueba de idempotencia contra el doble no
// probaría nada, porque el doble aceptaría un duplicado que la base real descartaría.
type fakeStore struct {
	appended []storer.EntryRow
	seen     map[string]bool
	err      error
}

func (f *fakeStore) Append(_ context.Context, e storer.EntryRow) error {
	if f.err != nil {
		return f.err
	}
	if f.seen == nil {
		f.seen = make(map[string]bool)
	}
	key := e.ID.String() + "|" + e.OccurredAt.String()
	if f.seen[key] {
		return nil
	}
	f.seen[key] = true
	f.appended = append(f.appended, e)
	return nil
}

const (
	testEventID = "22222222-2222-4222-8222-222222222222"
	testActor   = "11111111-1111-4111-8111-111111111111"
)

// validEnvelope construye un sobre que el consumidor debería aceptar.
func validEnvelope(t *testing.T, mutate func(*Envelope)) []byte {
	t.Helper()
	env := Envelope{
		EventID:    testEventID,
		EventType:  "user.registered",
		OccurredAt: time.Now().UTC().Format(time.RFC3339),
		ActorRef:   testActor,
		Payload:    map[string]any{"user_id": testActor},
	}
	if mutate != nil {
		mutate(&env)
	}
	body, err := json.Marshal(env)
	require.NoError(t, err)
	return body
}

func deliver(body []byte, ack *acks) amqp.Delivery {
	return amqp.Delivery{
		Acknowledger: ack,
		DeliveryTag:  7,
		RoutingKey:   "user.registered",
		Body:         body,
	}
}

func newTestConsumer(store storer.Storer) *Consumer {
	return NewConsumer(store, slog.New(slog.NewTextHandler(io.Discard, nil)), "audit.q")
}

// ── las tres salidas ───────────────────────────────────────────────────────

func TestValidEventIsStoredAndAcked(t *testing.T) {
	t.Parallel()
	store, ack := &fakeStore{}, &acks{}

	newTestConsumer(store).handle(context.Background(), deliver(validEnvelope(t, nil), ack))

	require.Len(t, store.appended, 1)
	require.Equal(t, []uint64{7}, ack.acked)
	require.Empty(t, ack.nacked)

	entry := store.appended[0]
	require.Equal(t, testEventID, entry.ID.String(), "el event_id del sobre ES el id de la entrada")
	require.Equal(t, testActor, entry.ActorRef.String())
	require.Equal(t, "user.registered", entry.Operation)
	require.Equal(t, storer.ResultSuccess, entry.Result)
}

// TestWriteFailureIsRequeuedNotDeadLettered es la prueba cara de este archivo.
//
// Si un fallo transitorio de la base mandara el evento a la dead-letter, se perdería
// un registro de auditoría por un hipo de red.
func TestWriteFailureIsRequeuedNotDeadLettered(t *testing.T) {
	t.Parallel()
	store := &fakeStore{err: errors.New("la base no responde")}
	ack := &acks{}

	newTestConsumer(store).handle(context.Background(), deliver(validEnvelope(t, nil), ack))

	require.Equal(t, []uint64{7}, ack.nacked)
	require.Equal(t, []bool{true}, ack.requeued, "requeue=true: el mensaje debe volver a intentarse")
	require.Empty(t, ack.acked)
}

// TestMalformedEventGoesToDeadLetterWithoutRequeue: reintentar un mensaje que jamás se
// podrá interpretar bloquearía la cola indefinidamente detrás de él (FR-024).
func TestMalformedEventGoesToDeadLetterWithoutRequeue(t *testing.T) {
	t.Parallel()

	cases := map[string][]byte{
		"JSON ilegible":          []byte("{no es json"),
		"event_id no es UUID":    validEnvelope(t, func(e *Envelope) { e.EventID = "abc" }),
		"actor_ref no es UUID":   validEnvelope(t, func(e *Envelope) { e.ActorRef = "" }),
		"occurred_at no RFC3339": validEnvelope(t, func(e *Envelope) { e.OccurredAt = "ayer" }),
		"event_type vacío":       validEnvelope(t, func(e *Envelope) { e.EventType = "" }),
	}

	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			store, ack := &fakeStore{}, &acks{}

			newTestConsumer(store).handle(context.Background(), deliver(body, ack))

			require.Empty(t, store.appended, "no se escribe nada que no se pudo interpretar")
			require.Equal(t, []uint64{7}, ack.nacked)
			require.Equal(t, []bool{false}, ack.requeued, "sin requeue: no va a mejorar")
		})
	}
}

// ── contenido de la entrada ────────────────────────────────────────────────

// TestFailureResultComesFromTheProducer: quien produce el evento declara si la
// operación fracasó. En el momento en que Auditoría decidiera por su cuenta que cierto
// evento «es un fallo», tendría una opinión sobre el dominio de otro servicio.
func TestFailureResultComesFromTheProducer(t *testing.T) {
	t.Parallel()
	store, ack := &fakeStore{}, &acks{}
	body := validEnvelope(t, func(e *Envelope) {
		e.EventType = "auth.security_alert"
		e.Payload = map[string]any{"result": "failure"}
	})

	newTestConsumer(store).handle(context.Background(), deliver(body, ack))

	require.Equal(t, storer.ResultFailure, store.appended[0].Result)
}

// TestContextKeepsOnlyThePayload: el sobre ya está desglosado en columnas. Duplicarlo
// dentro de `context` guardaría el `actor_ref` dos veces en una tabla append-only, de
// la que ya no se puede retirar nada.
func TestContextKeepsOnlyThePayload(t *testing.T) {
	t.Parallel()
	store, ack := &fakeStore{}, &acks{}
	body := validEnvelope(t, func(e *Envelope) {
		e.Payload = map[string]any{"quiz_id": "q-1", "score": "85.55"}
	})

	newTestConsumer(store).handle(context.Background(), deliver(body, ack))

	var ctxJSON map[string]any
	require.NoError(t, json.Unmarshal(store.appended[0].Context, &ctxJSON))
	require.Equal(t, map[string]any{"quiz_id": "q-1", "score": "85.55"}, ctxJSON)
	// El puntaje cruza como STRING decimal, no como número (Principio VIII).
	require.IsType(t, "", ctxJSON["score"])
}

// TestOccurredAtComesFromTheProducer: `occurred_at` (cuándo pasó) y `recorded_at`
// (cuándo se registró, lo pone la base) son distintos a propósito. La diferencia entre
// ambos es el retraso de la cola, y es un dato de auditoría en sí mismo.
func TestOccurredAtComesFromTheProducer(t *testing.T) {
	t.Parallel()
	store, ack := &fakeStore{}, &acks{}
	cuando := time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)
	body := validEnvelope(t, func(e *Envelope) { e.OccurredAt = cuando.Format(time.RFC3339) })

	newTestConsumer(store).handle(context.Background(), deliver(body, ack))

	require.True(t, store.appended[0].OccurredAt.Equal(cuando))
	require.Zero(t, store.appended[0].RecordedAt, "recorded_at lo pone la base, no el consumidor")
}

// ── bucle de consumo ───────────────────────────────────────────────────────

// TestClosedChannelIsAnErrorSoMainReconnects: un canal cerrado sin contexto cancelado
// solo puede ser la conexión caída. Tratarlo como final ordenado dejaría el proceso
// vivo sin consumir nada — el peor de los estados, porque parece sano.
func TestClosedChannelIsAnErrorSoMainReconnects(t *testing.T) {
	t.Parallel()
	deliveries := make(chan amqp.Delivery)
	close(deliveries)

	err := newTestConsumer(&fakeStore{}).Run(context.Background(), deliveries)
	require.ErrorIs(t, err, ErrDeliveriesClosed)
}

// TestCancellationIsAnOrderlyStop: el apagado no es un fallo.
func TestCancellationIsAnOrderlyStop(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	require.NoError(t, newTestConsumer(&fakeStore{}).Run(ctx, make(chan amqp.Delivery)))
}

// ── esquema de evento (productor): los 11 eventos del catálogo ────────────
//
// T172 (D-13). El consumidor de Auditoría es intencionalmente agnóstico al
// `event_type` (registra CUALQUIER operación, ver `resultOf`): lo que hay que
// verificar no es que reconozca cada evento, sino que los ONCE payloads que
// `contracts/events/events-catalog.md` promete como esquema se acepten, se
// almacenen íntegros en `context`, y que ningún campo decimal (`score`) cruce
// como número JSON (Principio VIII) — un `float64` ahí sería un redondeo que
// nadie notaría hasta una auditoría regulatoria.

func TestAllElevenCatalogEventsAreAcceptedAndStored(t *testing.T) {
	t.Parallel()

	// Espejo de "Esquemas de payload (resumen)" en events-catalog.md. Los eventos
	// sin sección propia (`user.email_verified`, `auth.security_alert`,
	// `auth.session_revoked`) llevan el mínimo que su fila de la tabla implica.
	cases := map[string]map[string]any{
		"user.registered": {
			"user_id": testActor, "email": "persona@ejemplo.co", "display_name": "Persona",
			"verification_token": "tok-123", "verification_expires_at": "2026-01-01T00:00:00Z",
		},
		"user.email_verified":   {"user_id": testActor},
		"auth.password_changed": {"user_id": testActor, "email": "persona@ejemplo.co", "changed_at": "2026-01-01T00:00:00Z"},
		"auth.security_alert":   {"user_id": testActor, "reason": "logins_fallidos_repetidos"},
		"auth.session_revoked":  {"user_id": testActor, "session_id": "s-1"},
		"learning.article_published": {
			"article_id": "a-1", "version_no": 3, "title": "T", "category": "ahorro",
			"approved_by": "u-2", "created_by": "u-1",
		},
		"learning.quiz_graded": {
			"user_id": testActor, "quiz_id": "q-1", "attempt_no": 2, "score": "85.00", "passed": true,
		},
		"user.progress_milestone": {"user_id": testActor, "type": "hito_progreso", "payload": map[string]any{"points": 320}},
		"user.activity":           {"user_id": testActor, "type": "actividad", "payload": map[string]any{"points": 10}},
		"simulation.executed":     {"user_id": testActor, "simulation_id": "s-1", "calc_type": "credito", "currency": "COP"},
		"account.anonymized":      {"actor_ref": testActor, "anonymized_at": "2026-01-01T00:00:00Z"},
	}
	require.Len(t, cases, 11, "el catálogo declara exactamente 11 eventos")

	for eventType, payload := range cases {
		t.Run(eventType, func(t *testing.T) {
			t.Parallel()
			store, ack := &fakeStore{}, &acks{}
			body := validEnvelope(t, func(e *Envelope) {
				e.EventType = eventType
				e.Payload = payload
			})

			newTestConsumer(store).handle(context.Background(), deliver(body, ack))

			require.Len(t, store.appended, 1, "el evento se acepta y se almacena")
			require.Equal(t, []uint64{7}, ack.acked)
			require.Empty(t, ack.nacked)
			require.Equal(t, eventType, store.appended[0].Operation)

			var ctxJSON map[string]any
			require.NoError(t, json.Unmarshal(store.appended[0].Context, &ctxJSON))
			if score, ok := ctxJSON["score"]; ok {
				require.IsType(t, "", score, "score debe cruzar como string decimal (Principio VIII)")
			}
		})
	}
}

// ── consumo idempotente ─────────────────────────────────────────────────────

// TestDuplicateDeliveryIsIdempotent: la entrega del outbox es AT-LEAST-ONCE
// (research D-07), así que el mismo `event_id` puede llegar dos veces. Las dos
// entregas deben confirmarse (ack) y solo la primera debe dejar una fila: es el
// mismo `ON CONFLICT (id, occurred_at) DO NOTHING` que impone `storer_postgres.go`,
// modelado aquí en el doble (ver `fakeStore.Append`).
func TestDuplicateDeliveryIsIdempotent(t *testing.T) {
	t.Parallel()
	store := &fakeStore{}
	body := validEnvelope(t, func(e *Envelope) { e.EventType = "learning.quiz_graded" })

	first, second := &acks{}, &acks{}
	consumer := newTestConsumer(store)
	consumer.handle(context.Background(), deliver(body, first))
	consumer.handle(context.Background(), deliver(body, second))

	require.Len(t, store.appended, 1, "el duplicado no debe producir una segunda fila")
	require.Equal(t, []uint64{7}, first.acked, "la primera entrega se confirma")
	require.Equal(t, []uint64{7}, second.acked, "la segunda TAMBIÉN se confirma: el duplicado no es un fallo")
	require.Empty(t, first.nacked)
	require.Empty(t, second.nacked)
}
