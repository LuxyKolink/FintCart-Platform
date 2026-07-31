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
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

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
	// BindingsNotification: los eventos que generan un EMAIL.
	//
	// Son exactamente tres, y coinciden uno a uno con las tres plantillas que admite
	// el CHECK `notification_events_queue_template_valid` (`verificacion`,
	// `cambio_password`, `alerta_seguridad`). Esa coincidencia no es casual: un
	// binding sin plantilla entrega mensajes que el consumidor solo puede descartar.
	//
	// `events-catalog.md` asignaba además `learning.article_published`,
	// `user.progress_milestone` y `user.activity` a Notificación, con destino «bandeja
	// in-app». Esa asignación es ANTERIOR a la aclaración N-03 de `plan.md`, que pasó
	// la bandeja in-app al Servicio de Usuarios: Notificación es consumidor puro sin
	// gRPC y no puede servir la lectura de una bandeja, así que no puede ser su dueño.
	// Hoy la bandeja se alimenta por `Users.AppendInAppNotification`, llamado desde el
	// paso de la saga, y no por evento.
	//
	// Se retiran los tres bindings en lugar de dejarlos entregando mensajes que el
	// consumidor descarta. Una cola que recibe y tira en silencio es indistinguible de
	// una que funciona, hasta que alguien pregunta por qué no llegó un aviso.
	BindingsNotification = []string{
		EventUserRegistered,
		EventAuthPasswordChanged,
		EventAuthSecurityAlert,
	}

	// BindingsAudit: los eventos con valor probatorio (FR-025, FR-031).
	//
	// Incluye los ONCE eventos del catálogo. Junto con [BindingsNotification] eso
	// garantiza la propiedad que de verdad importa aquí: **ningún evento producido
	// carece de binding**. Un evento sin binding no da error —el exchange `topic`
	// acepta cualquier routing key— y el broker lo descarta en silencio, así que la
	// única defensa es que la lista esté completa.
	//
	// `user.progress_milestone` y `user.activity` entran por esa razón. El catálogo
	// les asignaba únicamente Notificación como consumidor, pero la aclaración N-03
	// dejó a Notificación sin nada que hacer con ellos (ver [BindingsNotification]);
	// sin este binding se publicarían para nadie. Auditar la actividad y los hitos de
	// un usuario es además coherente con FR-025.
	BindingsAudit = []string{
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

// Parámetros de declaración, nombrados en lugar de posicionales.
//
// `ExchangeDeclare` y `QueueDeclare` reciben cuatro y cinco booleanos seguidos. Una
// llamada como `QueueDeclare(q, true, false, false, false, args)` es ilegible y, lo
// que es peor, un `false` en la posición equivocada produce una cola *exclusive* o
// *auto-delete* que desaparece al cerrarse la conexión — y con ella todos los eventos
// que estuvieran esperando dentro.
const (
	// durable: la definición sobrevive a un reinicio del broker. Con `false`, un
	// reinicio de RabbitMQ borraría las colas y los eventos publicados mientras los
	// consumidores no estuvieran conectados se perderían sin traza.
	durable = true
	// autoDelete: la cola se borra cuando su último consumidor se va. Debe ser
	// `false`: `notification.q` tiene que acumular mientras Notificación se reinicia.
	autoDelete = false
	// internal: un exchange interno no admite publicaciones de clientes.
	internal = false
	// exclusive: la cola pertenece a una sola conexión. Debe ser `false` — las ≥ 2
	// réplicas de cada consumidor (D-12) comparten la misma cola.
	exclusive = false
	// noWait: no esperar la confirmación del broker. Debe ser `false`: sin la
	// confirmación, un parámetro incompatible no daría error aquí sino al cerrarse el
	// canal más tarde, lejos de la línea que lo causó.
	noWait = false
)

// queueArgs son los argumentos de las dos colas de trabajo.
//
// El dead-lettering (FR-024) es lo único que llevan, y es lo que impide que un solo
// mensaje envenenado —un sobre que el consumidor nunca podrá interpretar— bloquee
// indefinidamente todo lo que va detrás en la cola.
func queueArgs() amqp.Table {
	return amqp.Table{"x-dead-letter-exchange": ExchangeDeadLetter}
}

// Declare declara exchanges, colas y bindings de forma idempotente.
//
// Debe ser idempotente porque se ejecuta en cada arranque de cada réplica:
// `ExchangeDeclare` y `QueueDeclare` de AMQP lo son siempre que los parámetros
// coincidan, y dejan de serlo —cerrando el canal— si no coinciden. Por eso la
// topología está centralizada en este archivo y no repartida.
//
// El orden importa: primero los exchanges, luego las colas y por último los bindings.
// Declarar un binding contra un exchange que aún no existe es un error del canal, y en
// AMQP un error de canal invalida el canal entero, no solo esa operación.
func Declare(ch Channel) error {
	if err := ch.ExchangeDeclare(ExchangeName, ExchangeKind, durable, autoDelete, internal, noWait, nil); err != nil {
		return fmt.Errorf("declarar el exchange %q: %w", ExchangeName, err)
	}

	// La dead-letter es `fanout` y no `topic`: un mensaje descartado conserva su
	// routing key original, así que con `topic` haría falta un binding por cada
	// evento posible para no perderlo. `fanout` entrega a la DLQ venga de donde venga,
	// que es justo lo que se quiere de un destino de último recurso.
	if err := ch.ExchangeDeclare(ExchangeDeadLetter, "fanout", durable, autoDelete, internal, noWait, nil); err != nil {
		return fmt.Errorf("declarar el exchange de dead-letter %q: %w", ExchangeDeadLetter, err)
	}

	// La DLQ NO lleva `x-dead-letter-exchange`. Un mensaje que ya está en la
	// dead-letter y vuelve a fallar no tiene adónde ir; darle uno que apuntara de
	// vuelta al mismo sitio crearía un ciclo que gira para siempre.
	if _, err := ch.QueueDeclare(QueueDeadLetter, durable, autoDelete, exclusive, noWait, nil); err != nil {
		return fmt.Errorf("declarar la cola de dead-letter %q: %w", QueueDeadLetter, err)
	}
	if err := ch.QueueBind(QueueDeadLetter, "", ExchangeDeadLetter, noWait, nil); err != nil {
		return fmt.Errorf("enlazar %q con %q: %w", QueueDeadLetter, ExchangeDeadLetter, err)
	}

	// Las colas se declaran ANTES que los bindings de sus eventos, y las dos antes
	// de que el relay publique nada: un evento publicado sin cola declarada se
	// descarta en el exchange y no queda constancia de él en ninguna parte.
	queues := map[string][]string{
		QueueNotification: BindingsNotification,
		QueueAudit:        BindingsAudit,
	}
	// Orden fijo, no el del mapa: un fallo a mitad de la declaración debe dejar el
	// mismo estado parcial en cada arranque. Con el recorrido aleatorio de un mapa de
	// Go, dos reintentos del mismo despliegue dejarían topologías distintas.
	for _, queue := range []string{QueueNotification, QueueAudit} {
		if _, err := ch.QueueDeclare(queue, durable, autoDelete, exclusive, noWait, queueArgs()); err != nil {
			return fmt.Errorf("declarar la cola %q: %w", queue, err)
		}
		for _, key := range queues[queue] {
			if err := ch.QueueBind(queue, key, ExchangeName, noWait, nil); err != nil {
				return fmt.Errorf("enlazar %q con la routing key %q: %w", queue, key, err)
			}
		}
	}

	return nil
}
