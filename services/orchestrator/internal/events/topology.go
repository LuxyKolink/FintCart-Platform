// Topología RabbitMQ de la plataforma (Principio V, `contracts/events/events-catalog.md`).
//
// Vive en el Orquestador porque es el único productor que participa en todos los
// flujos multi-servicio y el punto natural donde declarar la topología al arrancar.
// Declararla desde cada servicio productor multiplicaría por cuatro las
// oportunidades de que dos declaraciones difieran en un parámetro —y una
// declaración incompatible de una cola existente hace que RabbitMQ cierre el canal
// con un error que no menciona qué parámetro cambió.
//
// Restricción constitucional (Principio V): SOLO Notificación y Auditoría pueden
// consumir. Las dos colas de este archivo son, por tanto, la lista completa.
package events

import (
	"errors"

	amqp "github.com/rabbitmq/amqp091-go"
)

// ErrNotImplemented marca lo que llega con T062.
var ErrNotImplemented = errors.New("events: no implementado")

// Channel es el subconjunto de `*amqp.Channel` que necesita la declaración de la
// topología.
//
// Es una interfaz y no el tipo concreto para poder probar que se declaran los
// bindings correctos sin un broker levantado: la lista de bindings es justo el
// tipo de cosa que se escribe mal una vez y nadie nota hasta que falta un correo
// en producción. `*amqp.Channel` la satisface sin adaptador.
type Channel interface {
	ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, args amqp.Table) error
	QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, args amqp.Table) (amqp.Queue, error)
	QueueBind(name, key, exchange string, noWait bool, args amqp.Table) error
}

// Exchange y colas.
//
// El exchange es `topic` y la routing key es el nombre del evento
// (`events-catalog.md` §Topología). Con `topic`, añadir un consumidor a una familia
// de eventos es un binding con comodín y no un cambio en el productor.
const (
	// Exchange principal de eventos de dominio.
	ExchangeName = "fintcart.events"
	// ExchangeKind es `topic`, no `fanout`: cada consumidor se suscribe a los
	// eventos que le corresponden y no a todos. Con `fanout`, Auditoría recibiría
	// los eventos de solo-notificación y tendría que descartarlos, lo que convierte
	// un filtro del broker en código de aplicación.
	ExchangeKind = "topic"

	// QueueNotification recibe los eventos que producen un email o una entrada en
	// la bandeja in-app.
	QueueNotification = "notification.q"
	// QueueAudit recibe los eventos que hay que registrar de forma inmutable.
	QueueAudit = "audit.q"

	// Dead-letter para reintentos (FR-024). Un evento que falla repetidamente sale
	// de la cola principal en lugar de bloquearla: sin dead-letter, un solo mensaje
	// envenenado detiene la entrega de todos los que van detrás.
	ExchangeDeadLetter = "fintcart.events.dlx"
	QueueDeadLetter    = "fintcart.events.dlq"
)

// Nombres de evento ≡ routing keys, tal como los fija `events-catalog.md`.
//
// Se declaran como constantes y no como literales dispersos porque un nombre mal
// escrito en un productor NO da error: el exchange `topic` acepta cualquier routing
// key, el mensaje no coincide con ningún binding y se descarta en silencio. El
// síntoma sería «algunos correos no llegan», sin traza de por qué.
const (
	// Producidos por el Orquestador (los siete del `event_outbox` CHECK).
	EventUserRegistered        = "user.registered"
	EventUserEmailVerified     = "user.email_verified"
	EventLearningQuizGraded    = "learning.quiz_graded"
	EventUserProgressMilestone = "user.progress_milestone"
	EventUserActivity          = "user.activity"
	EventSimulationExecuted    = "simulation.executed"
	EventAccountAnonymized     = "account.anonymized"

	// Producidos por Autenticación.
	EventAuthPasswordChanged = "auth.password_changed"
	EventAuthSecurityAlert   = "auth.security_alert"
	EventAuthSessionRevoked  = "auth.session_revoked"

	// Producido por Aprendizaje.
	EventLearningArticlePublished = "learning.article_published"
)

// Bindings de cada cola, según la columna «Consumidores» del catálogo.
//
// Se enumeran uno a uno en lugar de usar comodines (`user.*`) a propósito: el
// catálogo asigna consumidores evento por evento, y un comodín suscribiría
// automáticamente cualquier evento futuro de esa familia. Para Auditoría eso
// sería tolerable; para Notificación significaría enviar correos que nadie
// aprobó.
var (
	// BindingsNotification: los eventos que generan email o bandeja in-app.
	BindingsNotification = []string{
		EventUserRegistered,
		EventAuthPasswordChanged,
		EventAuthSecurityAlert,
		EventLearningArticlePublished,
		EventUserProgressMilestone,
		EventUserActivity,
	}

	// BindingsAudit: los eventos con valor probatorio (FR-025, FR-031).
	BindingsAudit = []string{
		EventUserRegistered,
		EventUserEmailVerified,
		EventAuthPasswordChanged,
		EventAuthSecurityAlert,
		EventAuthSessionRevoked,
		EventLearningArticlePublished,
		EventLearningQuizGraded,
		EventSimulationExecuted,
		EventAccountAnonymized,
	}
)

// Envelope es el sobre común de todos los eventos (`events-catalog.md`).
//
// `ActorRef` es un identificador OPACO, no el correo ni el nombre: permite
// trazabilidad en Auditoría incluso después de anonimizar al titular
// (FR-030/FR-031). Y `Payload` destinado a Auditoría no debe llevar PII — un
// `audit_log` es append-only por diseño, así que un dato personal que entre ahí
// no se puede retirar después, lo que convertiría el propio registro de la
// anonimización en una violación de ella.
type Envelope struct {
	EventID    string         `json:"event_id"`
	EventType  string         `json:"event_type"`
	OccurredAt string         `json:"occurred_at"` // RFC-3339 UTC
	ActorRef   string         `json:"actor_ref"`   // UUID opaco
	Payload    map[string]any `json:"payload"`
}

// Declare declara exchanges, colas y bindings de forma idempotente.
//
// T062 lo implementa. Debe ser idempotente porque se ejecuta en cada arranque de
// cada réplica: `ExchangeDeclare` y `QueueDeclare` de AMQP lo son siempre que los
// parámetros coincidan, y dejan de serlo —cerrando el canal— si no coinciden. Por
// eso la topología está centralizada en este archivo y no repartida.
func Declare(_ Channel) error {
	// T062: ExchangeDeclare(ExchangeName, ExchangeKind, durable) ·
	// ExchangeDeclare(ExchangeDeadLetter, "fanout", durable) ·
	// QueueDeclare de las tres colas con `x-dead-letter-exchange` ·
	// QueueBind de cada routing key de BindingsNotification y BindingsAudit.
	return ErrNotImplemented
}
