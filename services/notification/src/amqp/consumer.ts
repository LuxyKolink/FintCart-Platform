/**
 * Capa de TRANSPORTE del Servicio de Notificación (Principio IX, plan.md N-01).
 *
 * Notificación es un consumidor puro (Principio V): su transporte no es un servidor,
 * es una cola. Lo que hace este archivo es traducir cada mensaje de `notification.q` en
 * una fila de `notification_events_queue` y decidir su ack.
 *
 * El consumidor NO envía correos. Solo encola. Enviar aquí ataría el ack de AMQP a la
 * latencia de un servidor SMTP ajeno: un SMTP lento bloquearía el consumo y uno caído
 * devolvería los mensajes a la cola una y otra vez, reentregándolos a todas las
 * réplicas. Con la cola persistente de por medio, el ack depende de un INSERT.
 */
import type { Channel, ConsumeMessage } from 'amqplib';

import type { Logger } from '../logger.js';
import type { NotificationQueue } from '../repo/queue.js';

import { MalformedEventError, notificationFromMessage } from './mapping.js';

/** Etiqueta del consumidor en la consola de RabbitMQ. */
const CONSUMER_TAG = 'fintcart-notification';

/** Consumidor de `notification.q`. */
export class QueueConsumer {
  public constructor(
    private readonly queue: NotificationQueue,
    private readonly logger: Logger,
  ) {}

  /**
   * Registra el consumidor en el canal.
   *
   * `noAck: false` no es negociable: con auto-ack el broker da el mensaje por entregado
   * en cuanto sale por el socket, así que un fallo al encolar perdería la notificación
   * sin dejar rastro.
   */
  public async consume(channel: Channel, queueName: string): Promise<void> {
    await channel.consume(
      queueName,
      (msg) => {
        if (msg === null) {
          // `null` significa que el consumidor fue cancelado por el broker. El bucle de
          // reconexión de `main.ts` se encarga; aquí solo hay que no tocar el canal.
          return;
        }
        void this.handle(channel, msg);
      },
      { noAck: false, consumerTag: CONSUMER_TAG },
    );
  }

  /**
   * Procesa un mensaje y decide su ack.
   *
   * Las tres salidas no son intercambiables:
   *
   * - sobre ilegible → `nack(requeue=false)` → dead-letter (FR-024). Reintentarlo
   *   bloquearía la cola detrás de un mensaje que jamás se podrá interpretar.
   * - fallo al encolar → `nack(requeue=true)`. Fue la base, no el mensaje.
   * - encolado (o evento sin correo) → `ack`.
   */
  private async handle(channel: Channel, msg: ConsumeMessage): Promise<void> {
    let item: ReturnType<typeof notificationFromMessage>;
    try {
      item = notificationFromMessage(msg.content);
    } catch (err) {
      if (err instanceof MalformedEventError) {
        this.logger.error('evento descartado a dead-letter', {
          routing_key: msg.fields.routingKey,
          error: err.message,
        });
        channel.nack(msg, false, false);
        return;
      }
      throw err;
    }

    if (item === null) {
      // Evento válido que no produce correo. Se confirma y se descarta a propósito: no
      // es un error, y mandarlo a la dead-letter lo haría parecer uno.
      this.logger.info('evento sin correo asociado; se descarta', {
        routing_key: msg.fields.routingKey,
      });
      channel.ack(msg);
      return;
    }

    try {
      const encolado = await this.queue.enqueue(item);
      // `false` significa que el evento ya estaba: la entrega del outbox es
      // at-least-once (D-07), así que recibirlo dos veces es normal y no puede
      // producir dos correos.
      this.logger.info(encolado ? 'notificación encolada' : 'evento repetido; ya estaba encolado', {
        event_id: item.eventId,
        template: item.template,
      });
      channel.ack(msg);
    } catch (err) {
      this.logger.error('no se pudo encolar la notificación; se devuelve a la cola', {
        event_id: item.eventId,
        error: err instanceof Error ? err.message : String(err),
      });
      channel.nack(msg, false, true);
    }
  }
}
