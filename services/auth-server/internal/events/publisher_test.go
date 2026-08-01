// Pruebas del publicador de eventos (T092).
//
// Lo que se comprueba aquí NO se puede comprobar en la capa de aplicación: la forma
// del envelope y la routing key son el contrato con Notificación y Auditoría, y los
// dos fallos posibles son SILENCIOSOS. Un campo JSON renombrado se deserializa como
// vacío en el consumidor, y una routing key mal escrita hace que el exchange `topic`
// acepte el mensaje y lo descarte por no casar con ningún binding. En los dos casos
// el productor no ve ningún error: el síntoma es un registro de auditoría incompleto
// que nadie mira hasta que hace falta.
package events_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/stretchr/testify/require"

	"github.com/fintcart/platform/services/auth-server/internal/events"
	"github.com/fintcart/platform/services/auth-server/internal/server"
)

// fakeChannel captura la publicación en lugar de mandarla a un broker, y reproduce
// el protocolo de acuse: el `basic.ack` (o `basic.nack`) y, si el mensaje era
// `mandatory` y nadie lo escuchaba, el `basic.return` que lo precede.
type fakeChannel struct {
	exchange   string
	routingKey string
	mandatory  bool
	msg        amqp.Publishing
	publishErr error
	confirmErr error
	published  int
	closed     int

	// nack simula un broker que rechaza; unroutable, uno que acepta el mensaje y lo
	// descarta por no casar con ningún binding; silent, uno que nunca responde.
	nack       bool
	unroutable bool
	silent     bool
	// closeAcks simula el canal AMQP que muere por un error de protocolo —publicar en
	// un exchange que no existe—: la biblioteca cierra el canal de notificación.
	closeAcks bool

	acks    chan amqp.Confirmation
	returns chan amqp.Return
}

func (f *fakeChannel) Confirm(bool) error { return f.confirmErr }

func (f *fakeChannel) NotifyPublish(c chan amqp.Confirmation) chan amqp.Confirmation {
	f.acks = c
	return c
}

func (f *fakeChannel) NotifyReturn(c chan amqp.Return) chan amqp.Return {
	f.returns = c
	return c
}

func (f *fakeChannel) PublishWithContext(
	_ context.Context,
	exchange, key string,
	mandatory, _ bool,
	msg amqp.Publishing,
) error {
	f.published++
	f.exchange, f.routingKey, f.mandatory, f.msg = exchange, key, mandatory, msg
	if f.publishErr != nil {
		return f.publishErr
	}
	if f.silent {
		return nil
	}
	if f.closeAcks {
		close(f.acks)
		return nil
	}
	// El `basic.return` va ANTES del acuse: lo fija AMQP 0-9-1 y de ahí depende que
	// comprobar el retorno DESPUÉS del acuse, y sin bloquear, sea correcto.
	if f.unroutable && f.returns != nil {
		f.returns <- amqp.Return{ReplyCode: 312, ReplyText: "NO_ROUTE"}
	}
	if f.acks != nil {
		f.acks <- amqp.Confirmation{DeliveryTag: uint64(f.published), Ack: !f.nack}
	}
	return nil
}

func (f *fakeChannel) Close() error {
	f.closed++
	return nil
}

// discardLogger silencia la salida sin desactivar el registro: el publicador registra
// lo que no puede entregar, y una prueba no debe llenar la consola con ello.
func discardLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, nil))
}

// captureLogger devuelve un log que escribe en memoria.
//
// Las pruebas de entrega fallida se hacen SOBRE EL LOG a propósito: mientras este
// servicio no tenga cola durable, el registro es literalmente el único sitio donde
// queda constancia de un evento perdido. Comprobar que la función «no entra en
// pánico» dejaría pasar la versión que se lo traga en silencio, que es el fallo que
// importa.
func captureLogger(buf *bytes.Buffer) *slog.Logger {
	return slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

// requireDropped exige que el evento se haya registrado como no entregado, con el
// envelope entero: es lo que lo hace reconstruible a mano.
func requireDropped(t *testing.T, logged string, causa string) {
	t.Helper()
	require.Contains(t, logged, "evento no entregado al bus")
	require.Contains(t, logged, causa)
	require.Contains(t, logged, "auth.session_revoked")
}

func TestPublishBuildsTheCatalogEnvelope(t *testing.T) {
	t.Parallel()
	ch := &fakeChannel{}
	publisher := events.NewAMQPPublisher(func() (events.Channel, error) { return ch, nil }, discardLogger())

	before := time.Now().UTC()
	publisher.Publish(context.Background(), server.Event{
		Type:     server.EventAuthSessionRevoked,
		ActorRef: "3f0f8b2e-2c53-4a2c-9f0a-1d2e3f4a5b6c",
		Payload:  map[string]any{"token_type": "access_token", "jti": "jti-1"},
	})

	require.Equal(t, 1, ch.published)
	require.Equal(t, events.ExchangeName, ch.exchange)
	// La routing key es el NOMBRE del evento, tal como fija el catálogo para un
	// exchange `topic`.
	require.Equal(t, "auth.session_revoked", ch.routingKey)

	// El envelope se comprueba sobre el JSON y no sobre un struct: los consumidores
	// ven bytes, y un campo renombrado seguiría pasando cualquier prueba que
	// deserializara con el mismo tipo que lo serializó.
	var env map[string]any
	require.NoError(t, json.Unmarshal(ch.msg.Body, &env))
	require.Equal(t, []string{"actor_ref", "event_id", "event_type", "occurred_at", "payload"}, sortedKeys(env))
	require.Equal(t, "auth.session_revoked", env["event_type"])
	require.Equal(t, "3f0f8b2e-2c53-4a2c-9f0a-1d2e3f4a5b6c", env["actor_ref"])

	// `occurred_at` es RFC-3339 en UTC. Se parsea de verdad en lugar de comprobar que
	// no está vacío: una fecha en hora local también sería una cadena no vacía, y
	// Auditoría ordenaría mal los eventos de dos réplicas en husos distintos.
	occurred, err := time.Parse(time.RFC3339Nano, env["occurred_at"].(string))
	require.NoError(t, err)
	require.Equal(t, time.UTC, occurred.UTC().Location())
	require.False(t, occurred.Before(before.Truncate(time.Second)))

	// `event_id` es la clave de idempotencia de los consumidores y viaja también en la
	// cabecera: quien deduplique por `MessageId` y quien lo haga por el cuerpo tienen
	// que ver el mismo valor.
	require.NotEmpty(t, env["event_id"])
	require.Equal(t, env["event_id"], ch.msg.MessageId)

	// Persistente: en modo transitorio un reinicio del broker borra el evento, y un
	// registro de auditoría con huecos parece completo.
	require.Equal(t, amqp.Persistent, ch.msg.DeliveryMode)
	require.Equal(t, "application/json", ch.msg.ContentType)

	// `mandatory`: sin ella, un evento que no casa con ningún binding se descarta y el
	// broker lo confirma igual, así que se contaría como entregado.
	require.True(t, ch.mandatory)

	// El canal se cierra siempre: se abre uno por evento, y no cerrarlos los acumula
	// hasta agotar el límite de la conexión.
	require.Equal(t, 1, ch.closed)
}

// TestPublishGivesEveryEventItsOwnID: el `event_id` es lo que permite a Notificación
// y Auditoría descartar una reentrega. Compartido entre dos eventos, el segundo se
// descartaría como si fuera una copia del primero.
func TestPublishGivesEveryEventItsOwnID(t *testing.T) {
	t.Parallel()
	seen := map[string]bool{}
	ch := &fakeChannel{}
	publisher := events.NewAMQPPublisher(func() (events.Channel, error) { return ch, nil }, discardLogger())

	for range 5 {
		publisher.Publish(context.Background(), server.Event{
			Type: server.EventAuthSessionRevoked, ActorRef: "actor",
			Payload: map[string]any{"token_type": "refresh_token"},
		})
		require.False(t, seen[ch.msg.MessageId], "el event_id se repitió")
		seen[ch.msg.MessageId] = true
	}
}

// TestPublishSurvivesABrokerFailure: el puerto no devuelve error, así que un fallo no
// puede entrar en pánico ni dejar el canal abierto — y tiene que quedar registrado.
func TestPublishSurvivesABrokerFailure(t *testing.T) {
	t.Parallel()
	var logged bytes.Buffer
	ch := &fakeChannel{publishErr: errors.New("canal cerrado")}
	publisher := events.NewAMQPPublisher(func() (events.Channel, error) { return ch, nil }, captureLogger(&logged))

	require.NotPanics(t, func() {
		publisher.Publish(context.Background(), server.Event{Type: server.EventAuthSessionRevoked})
	})
	require.Equal(t, 1, ch.closed)
	requireDropped(t, logged.String(), "canal cerrado")
}

// ── los tres fallos que sin acuse serían indistinguibles del éxito ──────────
//
// Los tres casos siguientes devuelven `nil` en `PublishWithContext`: la publicación
// AMQP retorna en cuanto escribe en el socket. Sin confirmaciones, los tres se
// contarían como eventos entregados y el registro de auditoría tendría huecos que
// nada delata.

// TestPublishDetectsABrokerRejection: un `nack` es el broker diciendo que NO se hizo
// cargo —disco lleno, cola en estado de flujo—.
func TestPublishDetectsABrokerRejection(t *testing.T) {
	t.Parallel()
	var logged bytes.Buffer
	ch := &fakeChannel{nack: true}
	publisher := events.NewAMQPPublisher(func() (events.Channel, error) { return ch, nil }, captureLogger(&logged))

	publisher.Publish(context.Background(), server.Event{
		Type: server.EventAuthSessionRevoked, ActorRef: "actor",
	})
	requireDropped(t, logged.String(), "rechazó el mensaje")
}

// TestPublishDetectsAnUnroutableEvent es el caso más probable de los tres en un
// despliegue real: el exchange existe y acepta el mensaje, pero `audit.q` todavía no
// está enlazada. El broker CONFIRMA el mensaje y lo tira, así que el acuse por sí solo
// no bastaría — hace falta el `basic.return`.
func TestPublishDetectsAnUnroutableEvent(t *testing.T) {
	t.Parallel()
	var logged bytes.Buffer
	ch := &fakeChannel{unroutable: true}
	publisher := events.NewAMQPPublisher(func() (events.Channel, error) { return ch, nil }, captureLogger(&logged))

	publisher.Publish(context.Background(), server.Event{
		Type: server.EventAuthSessionRevoked, ActorRef: "actor",
	})
	requireDropped(t, logged.String(), "ningún binding")
	requireDropped(t, logged.String(), "NO_ROUTE")
}

// TestPublishDetectsAChannelThatDiesBeforeTheAck: un error de protocolo —publicar en
// un exchange que el Orquestador aún no declaró— cierra el canal AMQP, y con él el
// canal de notificación.
func TestPublishDetectsAChannelThatDiesBeforeTheAck(t *testing.T) {
	t.Parallel()
	var logged bytes.Buffer
	ch := &fakeChannel{closeAcks: true}
	publisher := events.NewAMQPPublisher(func() (events.Channel, error) { return ch, nil }, captureLogger(&logged))

	publisher.Publish(context.Background(), server.Event{
		Type: server.EventAuthSessionRevoked, ActorRef: "actor",
	})
	requireDropped(t, logged.String(), "se cerró antes del acuse")
}

// TestPublishStillPublishesWithoutConfirmations: si el broker no admite activar las
// confirmaciones, el evento se publica igual. Un evento entregado sin acuse es mejor
// que un evento no entregado; lo que no se hace es callar que la vigilancia se quedó
// sin cobertura.
func TestPublishStillPublishesWithoutConfirmations(t *testing.T) {
	t.Parallel()
	var logged bytes.Buffer
	ch := &fakeChannel{confirmErr: errors.New("modo confirm no disponible")}
	publisher := events.NewAMQPPublisher(func() (events.Channel, error) { return ch, nil }, captureLogger(&logged))

	publisher.Publish(context.Background(), server.Event{
		Type: server.EventAuthSessionRevoked, ActorRef: "actor",
	})
	require.Equal(t, 1, ch.published)
	require.Equal(t, 1, ch.closed)
	require.Contains(t, logged.String(), "sin acuse")
	require.NotContains(t, logged.String(), "evento no entregado al bus")
}

// TestPublishSurvivesAChannelThatCannotBeOpened cubre el arranque real: si Auth
// levanta antes de que el Orquestador declare la topología, el primer evento falla.
// Con un canal por evento el siguiente empieza limpio, sin código de reconexión.
func TestPublishSurvivesAChannelThatCannotBeOpened(t *testing.T) {
	t.Parallel()
	publisher := events.NewAMQPPublisher(
		func() (events.Channel, error) { return nil, errors.New("conexión caída") },
		discardLogger(),
	)

	require.NotPanics(t, func() {
		publisher.Publish(context.Background(), server.Event{Type: server.EventAuthSessionRevoked})
	})
}

// TestPublishOutlivesTheCallersContext: el evento se produce DESPUÉS de un efecto
// irreversible. Un cliente que cuelga justo tras el logout no puede impedir que la
// revocación quede auditada.
func TestPublishOutlivesTheCallersContext(t *testing.T) {
	t.Parallel()
	ch := &fakeChannel{}
	publisher := events.NewAMQPPublisher(func() (events.Channel, error) { return ch, nil }, discardLogger())

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	publisher.Publish(ctx, server.Event{Type: server.EventAuthSessionRevoked, ActorRef: "actor"})
	require.Equal(t, 1, ch.published)
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}
