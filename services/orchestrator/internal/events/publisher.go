package events

import (
	"context"
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

// PublishChannel es el subconjunto de `*amqp.Channel` que necesita publicar.
//
// Se declara aparte de [Channel] —que declara la topología— porque son dos
// responsabilidades con ciclos de vida distintos: la topología se declara una vez al
// arrancar y la publicación ocurre en cada evento. Un solo interfaz con los cuatro
// métodos obligaría a un doble de prueba a implementar los tres que no usa.
type PublishChannel interface {
	PublishWithContext(
		ctx context.Context,
		exchange, key string,
		mandatory, immediate bool,
		msg amqp.Publishing,
	) error
}

// AMQPPublisher entrega eventos del outbox a RabbitMQ.
//
// Implementa `outbox.Publisher`. Vive aquí y no en `internal/outbox` para que ese
// paquete —donde está la lógica de barrido y reintento— no dependa de AMQP y se
// pueda probar sin broker.
type AMQPPublisher struct {
	ch PublishChannel
}

// NewAMQPPublisher envuelve un canal ya abierto.
func NewAMQPPublisher(ch PublishChannel) *AMQPPublisher {
	return &AMQPPublisher{ch: ch}
}

// Publish envía un evento al exchange con la routing key indicada.
//
// `DeliveryMode: Persistent` no es opcional: con el modo transitorio el broker
// guarda el mensaje solo en memoria y un reinicio de RabbitMQ lo pierde. Todo el
// mecanismo del outbox transaccional (D-07) existe para que un evento confirmado no
// se pierda; publicarlo como transitorio anularía esa garantía en el último paso.
//
// `mandatory: false` es deliberado y tiene una consecuencia que hay que conocer: un
// evento cuya routing key no case con ningún binding se DESCARTA en silencio. La
// alternativa —`true` más un canal de `Return`— convertiría ese caso en un error
// visible, pero también en un fallo del publicador cada vez que se despliega un
// consumidor nuevo antes que su binding. La protección real está en que las routing
// keys son constantes de `topology.go` y no literales dispersos.
func (p *AMQPPublisher) Publish(ctx context.Context, exchange, routingKey string, body []byte) error {
	msg := amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
	}
	if err := p.ch.PublishWithContext(ctx, exchange, routingKey, false, false, msg); err != nil {
		return fmt.Errorf("publicar el evento %q en el exchange %q: %w", routingKey, exchange, err)
	}
	return nil
}
