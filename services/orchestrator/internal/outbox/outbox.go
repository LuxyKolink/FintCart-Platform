// Publicador del outbox transaccional (research D-07).
//
// El problema que resuelve: no existe una transacción que abarque PostgreSQL y
// RabbitMQ, y la constitución prohíbe 2PC. Así que publicar el evento dentro de la
// transacción de la saga es imposible, y publicarlo justo después deja una ventana
// —si el proceso muere ahí, el evento se pierde sin traza.
//
// La solución es invertir el orden: el evento se ESCRIBE en `event_outbox` en la
// misma transacción que el avance de la saga (garantía de `storer.AdvanceSaga`), y
// este publicador lo envía después, marcándolo como publicado. Si el proceso muere
// en cualquier punto, el evento sigue en la tabla y se reintenta.
//
// La contrapartida es explícita y hay que asumirla: la entrega es AT-LEAST-ONCE. Un
// evento puede publicarse dos veces si el proceso muere entre el publish y el
// marcado. Por eso el catálogo exige consumo IDEMPOTENTE por `event_id` — y por eso
// `notification_events_queue` tiene `event_id UNIQUE`.
package outbox

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// ErrNotImplemented marca lo que llega con T061.
var ErrNotImplemented = errors.New("outbox: no implementado")

// Store es lo que el publicador necesita de la persistencia.
//
// Es un puerto estrecho declarado en el consumidor, no `storer.Storer` completo:
// este paquete no tiene ninguna razón para poder tocar `saga_state`, y el tipo lo
// impide en lugar de confiar en que nadie lo haga.
type Store interface {
	ListPendingEvents(ctx context.Context, limit int32) ([]storer.OutboxRow, error)
	MarkEventPublished(ctx context.Context, eventID uuid.UUID) error
	IncrementEventAttempts(ctx context.Context, eventID uuid.UUID, cause error) error
}

// Publisher entrega un evento al broker.
//
// Separa el «qué publicar» (este paquete) del «cómo hablar con AMQP», para que la
// lógica de barrido y reintento se pueda probar sin broker.
type Publisher interface {
	Publish(ctx context.Context, exchange, routingKey string, body []byte) error
}

// Relay barre el outbox y publica lo pendiente.
type Relay struct {
	store     Store
	publisher Publisher
	logger    *slog.Logger
	exchange  string
	batchSize int32
	interval  time.Duration
}

// Config son los parámetros de operación del relay.
//
// Salen de variables de entorno leídas en `cmd/orchestrator/main.go` (Principio X);
// este paquete no lee entorno.
type Config struct {
	// Exchange al que publicar (`events.ExchangeName`).
	Exchange string
	// BatchSize acota cuántos eventos se traen por barrido. Sin cota, un backlog
	// acumulado tras una caída del broker se cargaría entero en memoria en el primer
	// barrido después de recuperarse.
	BatchSize int32
	// Interval es la espera entre barridos cuando no hay nada pendiente.
	Interval time.Duration
}

// NewRelay construye el relay.
func NewRelay(store Store, publisher Publisher, logger *slog.Logger, cfg Config) *Relay {
	return &Relay{
		store:     store,
		publisher: publisher,
		logger:    logger,
		exchange:  cfg.Exchange,
		batchSize: cfg.BatchSize,
		interval:  cfg.Interval,
	}
}

// Run barre el outbox hasta que se cancele el contexto.
//
// Termina devolviendo nil al cancelarse, no un error: la cancelación es el apagado
// ordenado, no un fallo, y tratarla como error haría que cada `dev/down` dejara un
// log de error espurio.
func (r *Relay) Run(ctx context.Context) error {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			r.logger.InfoContext(ctx, "publicador del outbox detenido")
			return nil
		case <-ticker.C:
			if err := r.drainOnce(ctx); err != nil {
				// Un barrido fallido no detiene el relay: el evento sigue en la tabla
				// y el siguiente ciclo lo reintenta. Abortar aquí convertiría un
				// hipo del broker en la parada permanente de toda la publicación.
				r.logger.ErrorContext(ctx, "barrido del outbox fallido", slog.String("error", err.Error()))
			}
		}
	}
}

// drainOnce publica un lote de eventos pendientes.
func (r *Relay) drainOnce(ctx context.Context) error {
	pending, err := r.store.ListPendingEvents(ctx, r.batchSize)
	if err != nil {
		return fmt.Errorf("listar eventos pendientes: %w", err)
	}

	for _, ev := range pending {
		// T061 completa el cuerpo: publicar con `r.publisher.Publish` y, según el
		// resultado, `MarkEventPublished` o `IncrementEventAttempts`.
		//
		// Dos detalles que no son negociables:
		//   - El orden por `created_at` se respeta y se publica en SERIE, no en
		//     paralelo. Dos eventos de la misma saga entregados fuera de orden
		//     dejarían a Auditoría con una secuencia que no ocurrió.
		//   - El mensaje debe ir con `DeliveryMode: Persistent`. Un evento
		//     transitorio se pierde al reiniciar el broker, y entonces todo este
		//     mecanismo no habría servido de nada.
		_ = ev
		return ErrNotImplemented
	}
	return nil
}
