// Producción de eventos del Servidor de Autenticación hacia RabbitMQ
// (Principio V: Autenticación es productor; consumen Notificación y Auditoría).
//
// Este paquete es un ADAPTADOR: implementa el puerto [server.EventPublisher] y es
// el único sitio del servicio que conoce AMQP. La capa de aplicación produce un
// [server.Event] —tipo, actor y payload— y aquí se le pone el envelope del catálogo,
// se serializa y se entrega. Esa frontera es la que permite probar la revocación de
// sesiones sin un broker levantado.
//
// Este servicio NO declara la topología. La declara el Orquestador
// (`orchestrator/internal/events/topology.go`) por una razón concreta: cuatro
// productores declarando el mismo exchange son cuatro oportunidades de que uno
// difiera en un parámetro, y una declaración incompatible de un exchange existente
// hace que RabbitMQ cierre el canal con un error que no dice qué parámetro cambió.
package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/fintcart/platform/services/auth-server/internal/server"
)

const (
	// ExchangeName replica el exchange del catálogo de eventos. Está duplicado
	// respecto al Orquestador porque son módulos Go distintos y no comparten código;
	// la fuente de verdad es `contracts/events/events-catalog.md`.
	ExchangeName = "fintcart.events"

	// publishTimeout acota la entrega.
	//
	// Sin plazo, un broker que acepta la conexión TCP y no responde dejaría colgado
	// el logout del usuario esperando a que se publique un evento de AUDITORÍA, que
	// es exactamente la inversión de prioridades que este paquete existe para evitar.
	publishTimeout = 5 * time.Second
)

// Channel es el subconjunto de `*amqp.Channel` que necesita publicar CON ACUSE.
//
// Es una interfaz para poder comprobar sin broker lo que de verdad importa aquí:
// que el envelope tiene la forma del catálogo y que la routing key es el nombre del
// evento. Un nombre mal escrito NO da error —el exchange `topic` acepta cualquier
// routing key y descarta lo que no case con ningún binding—, así que el único sitio
// donde ese fallo se puede atrapar es una prueba.
//
// Los dos métodos de notificación son los que hacen que el registro de un evento
// perdido signifique algo. Sin ellos, `PublishWithContext` devuelve `nil` en cuanto
// escribe en el socket y NO espera al broker: un exchange inexistente o una cola sin
// binding se verían exactamente igual que una entrega correcta.
//
//   - `Confirm` + `NotifyPublish` — el broker ACEPTÓ el mensaje y lo persistió.
//   - `NotifyReturn` — nadie estaba escuchando: la routing key no casó con ningún
//     binding. Es un caso distinto del anterior y AMQP lo confirma igual, así que sin
//     esta segunda notificación un evento descartado se contaría como entregado.
type Channel interface {
	Confirm(noWait bool) error
	NotifyPublish(chan amqp.Confirmation) chan amqp.Confirmation
	NotifyReturn(chan amqp.Return) chan amqp.Return
	PublishWithContext(
		ctx context.Context,
		exchange, key string,
		mandatory, immediate bool,
		msg amqp.Publishing,
	) error
	Close() error
}

// Opener abre un canal AMQP nuevo sobre la conexión del proceso.
//
// Se abre uno POR EVENTO y se cierra al terminar, en lugar de reutilizar uno vivo.
// El motivo es una particularidad de AMQP: un error de protocolo —publicar en un
// exchange que todavía no existe porque el Orquestador aún no arrancó— CIERRA el
// canal, y a partir de ahí todas las publicaciones siguientes fallan sobre un canal
// muerto. Con un canal por evento, el fallo afecta a un evento y el siguiente
// empieza limpio; el servicio se recupera solo sin código de reconexión.
//
// El coste es un ida y vuelta extra al broker por evento, y es asumible porque este
// servicio produce eventos poco frecuentes —cierres de sesión, cambios de contraseña,
// alertas—. Si algún día produce eventos por segundo, lo correcto será un canal
// reutilizado con reapertura ante error, no dejar esto como está.
type Opener func() (Channel, error)

// AMQPPublisher implementa [server.EventPublisher].
type AMQPPublisher struct {
	open   Opener
	logger *slog.Logger
}

// NewAMQPPublisher construye el publicador.
func NewAMQPPublisher(open Opener, logger *slog.Logger) *AMQPPublisher {
	return &AMQPPublisher{open: open, logger: logger}
}

// envelope es el sobre común del catálogo (`events-catalog.md` §Envelope común).
//
// Las etiquetas JSON son parte del CONTRATO con Notificación y Auditoría, que están
// escritos en TypeScript y Go respectivamente: renombrar un campo aquí rompe a los
// dos consumidores en silencio, porque un campo ausente se deserializa como vacío.
type envelope struct {
	EventID    string         `json:"event_id"`
	EventType  string         `json:"event_type"`
	OccurredAt string         `json:"occurred_at"`
	ActorRef   string         `json:"actor_ref"`
	Payload    map[string]any `json:"payload"`
}

// newEnvelope pone identificador y fecha al evento.
//
// `event_id` es la clave de idempotencia con la que los consumidores descartan una
// reentrega, así que se genera UNA vez por evento y viaja también como `MessageId`
// de AMQP: un consumidor que deduplique por la cabecera y otro que lo haga por el
// cuerpo tienen que estar viendo el mismo valor.
//
// La fecha es UTC con nanosegundos. `RFC3339` a secas bastaría para el formato, pero
// dos revocaciones dentro del mismo segundo quedarían con la misma marca y Auditoría
// no podría ordenarlas — y el orden de los cierres de sesión es justo lo que se le
// pregunta a una traza de auditoría.
func newEnvelope(event server.Event) envelope {
	return envelope{
		EventID:    uuid.NewString(),
		EventType:  event.Type,
		OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
		ActorRef:   event.ActorRef,
		Payload:    event.Payload,
	}
}

// Publish entrega el evento al exchange de la plataforma.
//
// No devuelve error a propósito: ver el contrato de [server.EventPublisher]. Lo que
// no se puede entregar se registra con el envelope COMPLETO, para que el evento
// perdido se pueda reconstruir desde el log — es la única red que hay mientras este
// servicio no tenga outbox transaccional.
func (p *AMQPPublisher) Publish(ctx context.Context, event server.Event) {
	// `WithoutCancel` es deliberado: el evento se produce después de un efecto que ya
	// ocurrió, y un cliente que cuelga la conexión justo tras el logout no debe poder
	// impedir que la revocación quede auditada.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), publishTimeout)
	defer cancel()

	env := newEnvelope(event)

	body, err := json.Marshal(env)
	if err != nil {
		p.dropped(ctx, env, nil, fmt.Errorf("serializar el evento: %w", err))
		return
	}

	ch, err := p.open()
	if err != nil {
		p.dropped(ctx, env, body, fmt.Errorf("abrir canal AMQP: %w", err))
		return
	}
	defer func() {
		if err := ch.Close(); err != nil {
			p.logger.WarnContext(ctx, "fallo al cerrar el canal AMQP",
				slog.String("event_type", env.EventType),
				slog.String("error", err.Error()))
		}
	}()

	// Confirmaciones del publicador. Si no se pueden activar, se publica igualmente:
	// un evento entregado sin acuse es mejor que un evento no entregado. Lo que no se
	// hace es callarlo — quedaría un hueco en la vigilancia sin que nadie lo supiera.
	confirmed := true
	if err := ch.Confirm(false); err != nil {
		confirmed = false
		p.logger.WarnContext(ctx, "no se pudo activar la confirmación del publicador; el evento va sin acuse",
			slog.String("event_id", env.EventID),
			slog.String("event_type", env.EventType),
			slog.String("error", err.Error()))
	}

	// Los dos canales se registran ANTES de publicar. Al revés habría una carrera con
	// el propio broker: la confirmación de un mensaje ya enviado puede llegar antes de
	// que exista quien la escuche, y se perdería.
	var acks chan amqp.Confirmation
	var returns chan amqp.Return
	if confirmed {
		acks = ch.NotifyPublish(make(chan amqp.Confirmation, 1))
		returns = ch.NotifyReturn(make(chan amqp.Return, 1))
	}

	msg := amqp.Publishing{
		ContentType: "application/json",
		// `Persistent` no es opcional: en modo transitorio el broker guarda el mensaje
		// solo en memoria y un reinicio de RabbitMQ lo pierde. Un evento de auditoría
		// que desaparece al reiniciar el broker es peor que no tenerlo, porque el
		// registro parece completo.
		DeliveryMode: amqp.Persistent,
		MessageId:    env.EventID,
		Timestamp:    time.Now().UTC(),
		Type:         env.EventType,
		Body:         body,
	}

	// Routing key = nombre del evento, que es lo que fija el catálogo para un exchange
	// `topic`.
	//
	// `mandatory: true`, al contrario que en el Orquestador. Allí la marca convertiría
	// un consumidor desplegado antes que su binding en un FALLO de publicación; aquí no
	// hay nada que falle —el puerto no devuelve error— y lo único que cambia es que un
	// evento que nadie recibe deja rastro en lugar de desaparecer. Con el coste ya
	// pagado, la información sale gratis.
	if err := ch.PublishWithContext(ctx, ExchangeName, env.EventType, true, false, msg); err != nil {
		p.dropped(ctx, env, body, fmt.Errorf("publicar en el exchange %q: %w", ExchangeName, err))
		return
	}
	if !confirmed {
		return
	}

	p.awaitConfirmation(ctx, env, body, acks, returns)
}

// awaitConfirmation espera el acuse del broker y detecta el descarte por falta de
// binding.
//
// El orden de los dos casos importa y lo fija AMQP 0-9-1: para un mensaje `mandatory`
// que no se puede enrutar, el `basic.return` viaja SIEMPRE antes del `basic.ack`. Por
// eso el retorno se comprueba después del acuse y sin bloquear: cuando llega el acuse,
// el retorno ya está en su canal si iba a llegar.
func (p *AMQPPublisher) awaitConfirmation(
	ctx context.Context,
	env envelope,
	body []byte,
	acks chan amqp.Confirmation,
	returns chan amqp.Return,
) {
	select {
	case ack, ok := <-acks:
		if !ok {
			// El canal de notificación se cierra cuando lo hace el canal AMQP, y eso pasa
			// justo en el caso que más importa: un error de protocolo, como publicar en un
			// exchange que todavía no existe.
			p.dropped(ctx, env, body, errAckChannelClosed)
			return
		}
		if !ack.Ack {
			p.dropped(ctx, env, body, errBrokerRejected)
			return
		}
	case <-ctx.Done():
		// El mensaje pudo llegar o no: el acuse simplemente no volvió a tiempo. Se
		// registra como no entregado porque es lo único honesto que se puede afirmar.
		p.dropped(ctx, env, body, fmt.Errorf("esperando el acuse del broker: %w", ctx.Err()))
		return
	}

	select {
	case ret := <-returns:
		p.dropped(ctx, env, body,
			fmt.Errorf("%w: %d %s", errUnroutable, ret.ReplyCode, ret.ReplyText))
	default:
	}
}

// Causas de que un evento no llegue a su destino. Son errores propios y no cadenas
// sueltas porque cada uno pide una reacción distinta de quien opera el sistema:
// declarar la topología, mirar el broker o revisar los bindings.
var (
	errAckChannelClosed = errors.New("el canal AMQP se cerró antes del acuse")
	errBrokerRejected   = errors.New("el broker rechazó el mensaje (nack)")
	errUnroutable       = errors.New("ningún binding casó con la routing key: el evento se descartó")
)

// dropped deja constancia de un evento que no llegó al broker.
//
// Es `Error` y no `Warn`: significa que un hecho que debía quedar auditado no lo
// está, y eso merece una alerta, no una línea que nadie mira. Se registra el cuerpo
// entero porque es lo que hace el evento reconstruible; puede hacerse sin reparos
// porque el catálogo prohíbe datos personales en el payload destinado a Auditoría —
// el titular viaja como referencia opaca.
func (p *AMQPPublisher) dropped(ctx context.Context, env envelope, body []byte, err error) {
	p.logger.ErrorContext(ctx, "evento no entregado al bus",
		slog.String("event_id", env.EventID),
		slog.String("event_type", env.EventType),
		slog.String("actor_ref", env.ActorRef),
		slog.String("envelope", string(body)),
		slog.String("error", err.Error()))
}

// El adaptador satisface el puerto: si la firma del puerto cambia, esto falla al
// compilar y no en el primer cierre de sesión.
var _ server.EventPublisher = (*AMQPPublisher)(nil)
