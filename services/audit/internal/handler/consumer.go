// Capa de TRANSPORTE del Servicio de Auditoría (Principio IX, plan.md N-01).
//
// Auditoría es un CONSUMIDOR PURO (Principio V): no expone gRPC ni REST, así que su
// capa de transporte no es un servidor sino un consumidor AMQP. Esa es la «capa
// degenerada legítima» que describe N-01 — no falta la capa `handler`, es que el
// transporte entra por RabbitMQ.
//
// Tampoco hay capa `server`: entre desempaquetar un evento y escribir la fila no hay
// ninguna regla de negocio que aplicar. Interponer una capa de aplicación vacía sería
// ceremonia; lo que sí hay es la conversión sobre → fila, que ocurre aquí y solo aquí
// (Principio IX regla 3).
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/fintcart/platform/services/audit/internal/observability"
	"github.com/fintcart/platform/services/audit/internal/storer"
)

// ErrDeliveriesClosed indica que el broker cerró el canal de entregas.
//
// Es un error y no un final ordenado a propósito: el apagado lo señala el contexto,
// así que un canal cerrado sin contexto cancelado solo puede ser la conexión caída, y
// `main.go` tiene que reconectar. Tratarlo como final normal dejaría el proceso vivo
// sin consumir nada —el peor de los estados, porque parece sano.
var ErrDeliveriesClosed = errors.New("handler: el broker cerró el canal de entregas")

// errMalformedEvent marca un mensaje que no se puede interpretar.
//
// Es un error DISTINTO de un fallo de escritura, y la distinción decide el destino
// del mensaje: un evento mal formado nunca va a mejorar por reintentarlo, así que va
// directo a la dead-letter. Reintentarlo bloquearía la cola indefinidamente detrás de
// un mensaje que jamás se podrá procesar.
var errMalformedEvent = errors.New("handler: evento mal formado")

// Envelope es el sobre común de los eventos (`contracts/events/events-catalog.md`).
//
// Se declara aquí y no se importa del Orquestador porque `contracts/` es la única
// superficie compartida y contiene contratos, no código Go. La duplicación del struct
// es el precio de esa regla; el contrato que evita que las dos copias divergan es el
// catálogo, que sí está versionado.
type Envelope struct {
	EventID    string         `json:"event_id"`
	EventType  string         `json:"event_type"`
	OccurredAt string         `json:"occurred_at"` // RFC-3339 UTC
	ActorRef   string         `json:"actor_ref"`   // UUID opaco
	Payload    map[string]any `json:"payload"`
}

// Consumer lee eventos de `audit.q` y los escribe en el log inmutable.
type Consumer struct {
	store  storer.Storer
	logger *slog.Logger
	queue  string
}

// NewConsumer construye el consumidor.
//
// Recibe el nombre de la cola en lugar de fijarlo: el nombre viene del entorno
// (Principio X) y así una prueba de integración puede usar una cola propia sin
// interferir con la real.
func NewConsumer(store storer.Storer, logger *slog.Logger, queue string) *Consumer {
	return &Consumer{store: store, logger: logger, queue: queue}
}

// Deliveries es el canal de entrega de AMQP, como interfaz mínima.
//
// Se declara para poder alimentar el bucle de consumo desde una prueba sin broker: el
// manejo de ack/nack es justo la parte que se escribe mal y solo se nota cuando una
// cola se llena en producción.
type Deliveries <-chan amqp.Delivery

// Run consume hasta que se cancele el contexto.
//
// Devuelve nil al cancelarse: la cancelación es el apagado ordenado, no un fallo.
func (c *Consumer) Run(ctx context.Context, deliveries Deliveries) error {
	c.logger.InfoContext(ctx, "consumidor de auditoría iniciado", slog.String("queue", c.queue))

	for {
		select {
		case <-ctx.Done():
			c.logger.InfoContext(ctx, "consumidor de auditoría detenido")
			return nil
		case msg, ok := <-deliveries:
			if !ok {
				// El canal cerrado significa que el broker cortó la conexión. Se
				// devuelve error para que `main.go` reconecte: seguir en el bucle con un
				// canal cerrado consumiría CPU sin procesar nada.
				return fmt.Errorf("%w (cola %s)", ErrDeliveriesClosed, c.queue)
			}
			c.handle(ctx, msg)
		}
	}
}

// handle procesa un mensaje y decide su ack.
//
// Las tres salidas posibles no son intercambiables:
//
//	evento mal formado  → Nack(requeue=false) → dead-letter (FR-024)
//	fallo de escritura  → Nack(requeue=true)  → se reintenta
//	éxito               → Ack
//
// El caso peligroso es el segundo tratado como el primero: si un fallo transitorio de
// la base mandara el evento a la dead-letter, se perdería un registro de auditoría por
// un hipo de red — y `audit_log` es la fuente autoritativa de trazabilidad regulatoria
// (FR-025), así que un hueco ahí no se puede rellenar después.
func (c *Consumer) handle(ctx context.Context, msg amqp.Delivery) {
	// El consumo es la ÚNICA superficie de este servicio: sin medirlo aquí, Auditoría
	// no tendría ni throughput ni tasa de error, por el mero hecho de no atender
	// peticiones (§Observabilidad).
	start := time.Now()
	outcome := "success"
	defer func() { observability.Observe("audit.consume", outcome, time.Since(start)) }()

	entry, err := entryFromMessage(msg.Body)
	if err != nil {
		outcome = "malformed"
		c.logger.ErrorContext(ctx, "evento descartado a dead-letter",
			slog.String("queue", c.queue),
			slog.String("routing_key", msg.RoutingKey),
			slog.String("error", err.Error()),
		)
		// Sin requeue: no va a mejorar reintentándolo, y devolverlo a la cola lo
		// pondría delante de todos los demás una y otra vez.
		c.settle(ctx, msg.Nack(false, false), "nack-dead-letter", msg)
		return
	}

	if err := c.store.Append(ctx, entry); err != nil {
		outcome = "write_error"
		c.logger.ErrorContext(ctx, "fallo al registrar evento de auditoría",
			slog.String("event_id", entry.ID.String()),
			slog.String("operation", entry.Operation),
			slog.String("error", err.Error()),
		)
		// Con requeue: el fallo es de la base, no del mensaje. `audit_log` es la fuente
		// autoritativa de trazabilidad (FR-025) y un hueco no se puede rellenar
		// después, así que el evento tiene que volver a intentarse.
		c.settle(ctx, msg.Nack(false, true), "nack-requeue", msg)
		return
	}

	// El ack va DESPUÉS del INSERT confirmado, nunca antes: con ack previo, un fallo
	// de escritura perdería el evento sin que quedara constancia.
	c.settle(ctx, msg.Ack(false), "ack", msg)
	c.logger.DebugContext(ctx, "evento auditado",
		slog.String("event_id", entry.ID.String()),
		slog.String("operation", entry.Operation),
	)
}

// settle registra el fallo de un ack o un nack sin abortar el consumo.
//
// Un ack que falla significa casi siempre que el canal ya está muerto; el bucle lo
// detectará en la siguiente lectura y `main.go` reconectará. Lo que no se puede es
// pasarlo por alto en silencio: sin ack, el broker reentregará el mensaje al
// reconectar, y saber que eso va a ocurrir explica el duplicado que aparecerá en el
// log un minuto después.
func (c *Consumer) settle(ctx context.Context, err error, action string, msg amqp.Delivery) {
	if err == nil {
		return
	}
	c.logger.ErrorContext(ctx, "no se pudo confirmar el mensaje al broker",
		slog.String("queue", c.queue),
		slog.String("accion", action),
		slog.Uint64("delivery_tag", msg.DeliveryTag),
		slog.String("error", err.Error()),
	)
}

// entryFromMessage convierte el sobre JSON en la fila a insertar.
//
// Es la ÚNICA frontera de conversión del servicio (Principio IX regla 3). Aquí se
// valida todo lo que la base exigiría de todos modos, y se hace antes para poder
// distinguir «mensaje inválido» de «base caída» — distinción de la que depende el
// destino del mensaje (ver [Consumer.handle]).
func entryFromMessage(body []byte) (storer.EntryRow, error) {
	var env Envelope
	if err := json.Unmarshal(body, &env); err != nil {
		return storer.EntryRow{}, fmt.Errorf("%w: JSON ilegible: %w", errMalformedEvent, err)
	}

	// El `event_id` del sobre se convierte en el `id` de la entrada. Es lo que hace
	// el INSERT idempotente frente a la entrega at-least-once del outbox.
	id, err := uuid.Parse(env.EventID)
	if err != nil {
		return storer.EntryRow{}, fmt.Errorf("%w: event_id %q no es un UUID", errMalformedEvent, env.EventID)
	}

	actor, err := uuid.Parse(env.ActorRef)
	if err != nil {
		return storer.EntryRow{}, fmt.Errorf("%w: actor_ref %q no es un UUID", errMalformedEvent, env.ActorRef)
	}

	occurredAt, err := time.Parse(time.RFC3339, env.OccurredAt)
	if err != nil {
		return storer.EntryRow{}, fmt.Errorf("%w: occurred_at %q no es RFC-3339", errMalformedEvent, env.OccurredAt)
	}

	if env.EventType == "" {
		return storer.EntryRow{}, fmt.Errorf("%w: event_type vacío", errMalformedEvent)
	}

	// El payload se serializa de vuelta a JSON para la columna `context`. No se
	// reenvía `body` completo: el sobre ya está desglosado en columnas, y duplicarlo
	// dentro de `context` guardaría el `actor_ref` dos veces.
	contextJSON, err := json.Marshal(env.Payload)
	if err != nil {
		return storer.EntryRow{}, fmt.Errorf("%w: payload no serializable: %w", errMalformedEvent, err)
	}

	return storer.EntryRow{
		ID:         id,
		ActorRef:   actor,
		Operation:  env.EventType,
		Context:    contextJSON,
		Result:     resultOf(env.Payload),
		OccurredAt: occurredAt,
	}, nil
}

// resultOf deduce el desenlace de la operación auditada.
//
// Por defecto `success`: los eventos del catálogo describen hechos CONSUMADOS —una
// cuenta que se registró, un cuestionario que se calificó—, no intentos.
//
// Un productor que necesite auditar un fracaso lo declara con `"result": "failure"`
// en su payload. Que lo diga el productor y no una tabla de excepciones en Auditoría
// es deliberado: en el momento en que este servicio decidiera por su cuenta que
// `auth.security_alert` «es un fallo», tendría una opinión sobre el dominio de otro
// servicio, y esa opinión envejecería sin que nadie la revisara.
func resultOf(payload map[string]any) string {
	if raw, ok := payload["result"].(string); ok && raw == storer.ResultFailure {
		return storer.ResultFailure
	}
	return storer.ResultSuccess
}
