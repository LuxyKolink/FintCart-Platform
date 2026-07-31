package events

import (
	"errors"
	"testing"

	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/stretchr/testify/require"
)

// Pruebas de la topología de eventos.
//
// Existen porque un error aquí NO da error. El exchange es `topic` y acepta cualquier
// routing key: un evento cuyo binding falta se publica sin protesta, no coincide con
// ninguna cola y el broker lo descarta en silencio. El síntoma sería «algunos correos
// no llegan» o «faltan registros de auditoría», sin nada en ningún log que apunte a la
// causa. Este archivo es lo único que convierte esa clase de fallo en algo detectable.
//
// §Calidad: sin broker. La interfaz `Channel` existe justamente para esto.

// ── doble del canal ─────────────────────────────────────────────────────────

type declaredQueue struct {
	name string
	args amqp.Table
}

type binding struct {
	queue    string
	key      string
	exchange string
}

// fakeChannel apunta todo lo que se declara.
type fakeChannel struct {
	exchanges map[string]string // nombre → tipo
	queues    []declaredQueue
	bindings  []binding

	// failOn hace fallar la declaración del recurso con ese nombre.
	failOn string
}

var errBroker = errors.New("el broker rechazó la declaración")

func newFakeChannel() *fakeChannel {
	return &fakeChannel{exchanges: map[string]string{}}
}

func (f *fakeChannel) ExchangeDeclare(name, kind string, _, _, _, _ bool, _ amqp.Table) error {
	if name == f.failOn {
		return errBroker
	}
	f.exchanges[name] = kind
	return nil
}

func (f *fakeChannel) QueueDeclare(name string, _, _, _, _ bool, args amqp.Table) (amqp.Queue, error) {
	if name == f.failOn {
		return amqp.Queue{}, errBroker
	}
	f.queues = append(f.queues, declaredQueue{name: name, args: args})
	return amqp.Queue{Name: name}, nil
}

func (f *fakeChannel) QueueBind(name, key, exchange string, _ bool, _ amqp.Table) error {
	f.bindings = append(f.bindings, binding{queue: name, key: key, exchange: exchange})
	return nil
}

func (f *fakeChannel) queue(t *testing.T, name string) declaredQueue {
	t.Helper()
	for _, q := range f.queues {
		if q.name == name {
			return q
		}
	}
	t.Fatalf("la cola %q no se declaró", name)
	return declaredQueue{}
}

func (f *fakeChannel) keysOf(queue string) []string {
	var keys []string
	for _, b := range f.bindings {
		if b.queue == queue {
			keys = append(keys, b.key)
		}
	}
	return keys
}

// allCatalogEvents son los ONCE eventos de `contracts/events/events-catalog.md`.
//
// Se enumera aparte de `BindingsNotification`/`BindingsAudit` a propósito: si la
// lista se derivara de ellas, la prueba de cobertura no comprobaría nada — diría que
// todo lo enlazado está enlazado.
var allCatalogEvents = []string{
	EventUserRegistered,
	EventUserEmailVerified,
	EventAuthPasswordChanged,
	EventAuthSecurityAlert,
	EventAuthSessionRevoked,
	EventLearningArticlePublished,
	EventLearningQuizGraded,
	EventUserProgressMilestone,
	EventUserActivity,
	EventSimulationExecuted,
	EventAccountAnonymized,
}

// ── pruebas ────────────────────────────────────────────────────────────────

// TestEveryCatalogEventHasSomewhereToGo es la prueba que justifica este archivo.
//
// Un evento producido sin binding se descarta en el exchange. No hay error, no hay
// log y no hay mensaje en ninguna cola: desaparece.
func TestEveryCatalogEventHasSomewhereToGo(t *testing.T) {
	t.Parallel()
	ch := newFakeChannel()
	require.NoError(t, Declare(ch))

	bound := map[string]bool{}
	for _, b := range ch.bindings {
		if b.exchange == ExchangeName {
			bound[b.key] = true
		}
	}
	for _, ev := range allCatalogEvents {
		require.True(t, bound[ev], "el evento %q no está enlazado con ninguna cola", ev)
	}
}

// TestOnlyTheTwoAllowedConsumersHaveQueues: Principio V. Solo Notificación y
// Auditoría pueden consumir, así que solo puede haber sus dos colas de trabajo (más
// la dead-letter, que no tiene consumidor de servicio).
func TestOnlyTheTwoAllowedConsumersHaveQueues(t *testing.T) {
	t.Parallel()
	ch := newFakeChannel()
	require.NoError(t, Declare(ch))

	names := make([]string, 0, len(ch.queues))
	for _, q := range ch.queues {
		names = append(names, q.name)
	}
	require.ElementsMatch(t, []string{QueueNotification, QueueAudit, QueueDeadLetter}, names)
}

// TestNotificationOnlyReceivesWhatItCanSend: los bindings de Notificación coinciden
// uno a uno con las tres plantillas de correo del esquema. Un binding de más
// entregaría mensajes que el consumidor solo puede descartar, y una cola que recibe y
// tira en silencio es indistinguible de una que funciona.
func TestNotificationOnlyReceivesWhatItCanSend(t *testing.T) {
	t.Parallel()
	ch := newFakeChannel()
	require.NoError(t, Declare(ch))

	require.ElementsMatch(t, []string{
		EventUserRegistered,
		EventAuthPasswordChanged,
		EventAuthSecurityAlert,
	}, ch.keysOf(QueueNotification))
}

// TestAuditReceivesEverything: FR-025. Auditoría es la fuente autoritativa de
// trazabilidad, así que su cobertura no puede ser parcial.
func TestAuditReceivesEverything(t *testing.T) {
	t.Parallel()
	ch := newFakeChannel()
	require.NoError(t, Declare(ch))

	require.ElementsMatch(t, allCatalogEvents, ch.keysOf(QueueAudit))
}

// TestWorkQueuesDeadLetterButTheDLQDoesNot: sin dead-letter, un solo mensaje
// envenenado bloquea todo lo que va detrás (FR-024). Y una DLQ con dead-letter propio
// apuntando de vuelta crearía un ciclo que gira para siempre.
func TestWorkQueuesDeadLetterButTheDLQDoesNot(t *testing.T) {
	t.Parallel()
	ch := newFakeChannel()
	require.NoError(t, Declare(ch))

	for _, name := range []string{QueueNotification, QueueAudit} {
		q := ch.queue(t, name)
		require.Equal(t, ExchangeDeadLetter, q.args["x-dead-letter-exchange"],
			"la cola %q debe tener dead-letter", name)
	}
	require.Nil(t, ch.queue(t, QueueDeadLetter).args["x-dead-letter-exchange"])
}

// TestDeadLetterIsFanoutAndBound: un mensaje descartado conserva su routing key
// original, así que con un `topic` haría falta un binding por evento posible para no
// perderlo. `fanout` entrega venga de donde venga, que es lo que se espera de un
// destino de último recurso.
func TestDeadLetterIsFanoutAndBound(t *testing.T) {
	t.Parallel()
	ch := newFakeChannel()
	require.NoError(t, Declare(ch))

	require.Equal(t, ExchangeKind, ch.exchanges[ExchangeName])
	require.Equal(t, "fanout", ch.exchanges[ExchangeDeadLetter])
	require.Contains(t, ch.bindings, binding{queue: QueueDeadLetter, key: "", exchange: ExchangeDeadLetter})
}

// TestDeclarationStopsAtTheFirstFailure: en AMQP un error de canal invalida el canal
// ENTERO, no solo la operación que lo provocó. Seguir declarando después de un fallo
// produciría una cascada de errores que oculta el primero, que es el único útil.
func TestDeclarationStopsAtTheFirstFailure(t *testing.T) {
	t.Parallel()
	ch := newFakeChannel()
	ch.failOn = ExchangeName

	err := Declare(ch)
	require.ErrorIs(t, err, errBroker)
	require.Empty(t, ch.queues, "no se declara ninguna cola si el exchange falló")
}

// TestDeclareIsIdempotent: se ejecuta en cada arranque de cada réplica (D-12 exige
// ≥ 2). Si no lo fuera, la segunda réplica en arrancar cerraría su canal.
func TestDeclareIsIdempotent(t *testing.T) {
	t.Parallel()
	ch := newFakeChannel()
	require.NoError(t, Declare(ch))
	require.NoError(t, Declare(ch), "la segunda declaración debe pasar igual que la primera")
}
