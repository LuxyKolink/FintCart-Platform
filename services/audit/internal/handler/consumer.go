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

	"github.com/fintcart/platform/services/audit/internal/storer"
)

// ErrNotImplemented marca lo que llega con T063.
var ErrNotImplemented = errors.New("handler: no implementado")

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
				return fmt.Errorf("canal de entregas cerrado para la cola %s: %w", c.queue, ErrNotImplemented)
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
	entry, err := entryFromMessage(msg.Body)
	if err != nil {
		c.logger.ErrorContext(ctx, "evento descartado a dead-letter",
			slog.String("queue", c.queue),
			slog.String("routing_key", msg.RoutingKey),
			slog.String("error", err.Error()),
		)
		// T063: Nack(requeue=false). Sin requeue: no va a mejorar reintentándolo.
		return
	}

	if err := c.store.Append(ctx, entry); err != nil {
		c.logger.ErrorContext(ctx, "fallo al registrar evento de auditoría",
			slog.String("event_id", entry.ID.String()),
			slog.String("operation", entry.Operation),
			slog.String("error", err.Error()),
		)
		// T063: Nack(requeue=true). El evento debe volver a intentarse.
		return
	}

	// T063: Ack. El ack va DESPUÉS del INSERT confirmado, nunca antes: con ack previo,
	// un fallo de escritura perdería el evento sin que quedara constancia.
	c.logger.DebugContext(ctx, "evento auditado",
		slog.String("event_id", entry.ID.String()),
		slog.String("operation", entry.Operation),
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
		ID:        id,
		ActorRef:  actor,
		Operation: env.EventType,
		Context:   contextJSON,
		// T063 decide el `result` a partir del evento. Por defecto `success`: los
		// eventos del catálogo describen hechos consumados, y los fallos que hay que
		// auditar viajan como eventos propios (`auth.security_alert`).
		Result:     storer.ResultSuccess,
		OccurredAt: occurredAt,
	}, nil
}
