/**
 * Publicador de eventos de dominio de Aprendizaje (Principio V: Aprendizaje es
 * PRODUCTOR). Hoy el único evento es `learning.article_published` (T163, FR-008).
 *
 * Publica sobre el exchange `fintcart.events` (topic), que NO se declara aquí: la
 * topología completa —exchange, colas, bindings y dead-letter— la declara el
 * Orquestador en un único sitio al arrancar (`orchestrator/internal/events/topology.go`).
 * Redeclararla desde este servicio con un parámetro que discrepe, aunque sea por un
 * detalle, cierra el canal con un error de equivalencia que no dice cuál parámetro
 * cambió — el mismo razonamiento que ya sigue el consumidor de Notificación al NO
 * declarar su cola.
 *
 * `learning.article_published` está enlazado SOLO a `audit.q`
 * (`topology.go::BindingsAudit`), no a `notification.q`: la asignación original del
 * catálogo a Notificación era anterior a la aclaración N-03 de `plan.md` (la bandeja
 * in-app la sirve el Servicio de Usuarios, no Notificación, que es consumidor puro sin
 * gRPC). Publicar aquí con `mandatory: true` hace que un binding ausente se vea —el
 * broker devuelve el mensaje— en lugar de perderse en silencio si algún día el catálogo
 * y la topología volvieran a discrepar.
 *
 * No se implementa como outbox transaccional (a diferencia del Orquestador, D-07):
 * publicar DESPUÉS de que `ApproveAndPublish` ya confirmó su transacción es aceptable
 * porque la publicación del artículo YA ES el efecto durable — un evento no entregado
 * degrada la auditoría, no la corrección del catálogo. Ver la nota equivalente de
 * `auth-server/internal/server/credentials.go` sobre por qué ese servicio tampoco tiene
 * outbox.
 */
import { randomUUID } from 'node:crypto';

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import amqplib, { type ChannelModel, type ConfirmChannel } from 'amqplib';

import { JsonLogger } from '../common/observability';

/** Debe coincidir EXACTAMENTE con `orchestrator/internal/events/topology.go`. */
const EXCHANGE_NAME = 'fintcart.events';
const EVENT_ARTICLE_PUBLISHED = 'learning.article_published';

/** Sobre común de todos los eventos (`events-catalog.md`), espejo del `Envelope` de Go. */
interface Envelope {
  readonly event_id: string;
  readonly event_type: string;
  readonly occurred_at: string;
  readonly actor_ref: string;
  readonly payload: Record<string, unknown>;
}

/** Payload de `learning.article_published` (`events-catalog.md`). */
export interface ArticlePublishedPayload {
  readonly article_id: string;
  readonly version_no: number;
  readonly title: string;
  readonly category: string;
  readonly approved_by: string;
  readonly created_by: string;
}

@Injectable()
export class EventsPublisher implements OnModuleDestroy {
  private readonly logger = new JsonLogger();
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<ConfirmChannel> | null = null;

  public constructor(private readonly amqpAddr: string) {}

  /**
   * Publica `learning.article_published` (FR-008).
   *
   * NUNCA lanza: un evento no entregado es una degradación de la auditoría, no un
   * motivo para que `ApproveAndPublish` —cuya escritura en PostgreSQL YA se
   * confirmó— responda un error al coordinador que acaba de publicar con éxito.
   */
  public async publishArticlePublished(actorRef: string, payload: ArticlePublishedPayload): Promise<void> {
    const envelope: Envelope = {
      event_id: randomUUID(),
      event_type: EVENT_ARTICLE_PUBLISHED,
      occurred_at: new Date().toISOString(),
      actor_ref: actorRef,
      payload: { ...payload },
    };

    try {
      const channel = await this.channelReady();
      const delivered = await new Promise<boolean>((resolve, reject) => {
        const onReturn = (): void => resolve(false);
        channel.once('return', onReturn);
        channel.publish(
          EXCHANGE_NAME,
          EVENT_ARTICLE_PUBLISHED,
          Buffer.from(JSON.stringify(envelope)),
          { contentType: 'application/json', mandatory: true, persistent: true },
          (err) => {
            channel.removeListener('return', onReturn);
            if (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
              return;
            }
            resolve(true);
          },
        );
      });

      if (!delivered) {
        this.logger.error(
          `evento sin cola destino (devuelto por el broker): ${envelope.event_type} (${envelope.event_id})`,
          'EventsPublisher',
        );
        return;
      }
      this.logger.log(`evento publicado: ${envelope.event_type} (${envelope.event_id})`, 'EventsPublisher');
    } catch (err) {
      // Ver la cabecera: el fallo se registra y se traga. `ApproveAndPublish` no debe
      // fallar por una publicación que ocurre DESPUÉS de que su transacción ya cerró.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `no se pudo publicar el evento ${envelope.event_type} (${envelope.event_id}): ${reason}`,
        'EventsPublisher',
      );
    }
  }

  public async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
    } catch {
      // Intencionadamente vacío: el proceso ya está terminando.
    }
    try {
      await this.connection?.close();
    } catch {
      // Intencionadamente vacío: ídem.
    }
  }

  /**
   * Conexión perezosa y cacheada: la mayoría de los procesos de Aprendizaje nunca
   * publican (solo lo hace `ApproveAndPublish`), así que abrir el canal en el arranque
   * de TODAS las réplicas gastaría una conexión de RabbitMQ que casi nunca se usa.
   *
   * Si el canal o la conexión se cierran (broker reiniciado, red caída), la próxima
   * publicación reconecta: no hay reintento en bucle en segundo plano porque no hay
   * nada que consumir — un canal cerrado sin más tráfico no necesita reconectar hasta
   * que haya algo que publicar.
   */
  private async channelReady(): Promise<ConfirmChannel> {
    if (this.channel !== null) {
      return this.channel;
    }
    if (this.connecting !== null) {
      return this.connecting;
    }

    this.connecting = (async (): Promise<ConfirmChannel> => {
      const connection = await amqplib.connect(this.amqpAddr);
      const channel = await connection.createConfirmChannel();

      connection.once('close', () => {
        this.connection = null;
        this.channel = null;
      });
      connection.once('error', () => {
        this.connection = null;
        this.channel = null;
      });

      this.connection = connection;
      this.channel = channel;
      return channel;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }
}
