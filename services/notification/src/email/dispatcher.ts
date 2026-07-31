/**
 * Despachador de correos del Servicio de Notificación.
 *
 * Aquí vive la única decisión del servicio: ante un envío fallido, ¿se reintenta o se
 * da por perdido? La respuesta depende solo del número de intento y de `MAX_ATTEMPTS`,
 * y por eso está aquí y no dentro de la cola — la cola sabe ESCRIBIR las tres
 * transiciones, no cuál corresponde.
 *
 * El despachador está separado del consumidor de RabbitMQ a propósito (ver
 * `src/main.ts`). Enviar el correo dentro del handler del mensaje ataría el ack de AMQP
 * a la latencia de un servidor SMTP ajeno: un SMTP lento bloquearía el consumo y uno
 * caído devolvería los mensajes a la cola una y otra vez. Con la cola persistente de
 * por medio, el ack depende de un INSERT y el envío se reintenta a su ritmo.
 *
 * Es CONCURRENTE con un tope: los correos de un lote salen en paralelo, pero nunca más
 * de `concurrency` a la vez. Sin tope, un backlog de mil eventos abriría mil conexiones
 * SMTP simultáneas y el proveedor cortaría el tráfico por abuso justo cuando hay más
 * pendiente que enviar.
 */
import type { Logger } from '../logger.js';
import type { MetricsSink } from '../observability.js';
import type { ClaimedNotification, NotificationQueue } from '../repo/queue.js';

import { render } from './templates.js';

/** Correo listo para el transporte. */
export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * Transporte de correo.
 *
 * Es una interfaz para que el despachador se pueda probar sin un servidor SMTP: lo que
 * hay que verificar aquí son las tres transiciones de la cola, no que `nodemailer`
 * hable SMTP.
 */
export interface Mailer {
  send(email: OutgoingEmail): Promise<void>;
}

/** Parámetros de operación, todos de origen ambiental (Principio X). */
export interface DispatcherOptions {
  /** Reintentos antes de dar el evento por fallido (FR-024). */
  readonly maxAttempts: number;
  /** Cuántos eventos se reclaman por barrido. */
  readonly batchSize: number;
  /** Envíos simultáneos como máximo. */
  readonly concurrency: number;
  /** Milisegundos entre barridos. */
  readonly intervalMs: number;
}

/** Motivo con el que se cierran las filas que quedaron colgadas en el máximo. */
const EXHAUSTED_REASON = 'intentos agotados: el proceso terminó antes de registrar el desenlace';

/** Despachador de la cola de notificaciones. */
export class Dispatcher {
  public constructor(
    private readonly queue: NotificationQueue,
    private readonly mailer: Mailer,
    private readonly logger: Logger,
    private readonly metrics: MetricsSink,
    private readonly options: DispatcherOptions,
  ) {}

  /**
   * Barre la cola hasta que se aborte la señal.
   *
   * Un barrido que falla NO detiene el bucle: los eventos siguen en la cola y el ciclo
   * siguiente vuelve a intentarlo. Abortar aquí convertiría un hipo de la base en la
   * parada permanente de todos los envíos, y el proceso seguiría «arriba».
   */
  public async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.drainOnce();
      } catch (err) {
        this.logger.error('barrido de la cola de notificaciones fallido', {
          error: messageOf(err),
        });
      }
      await sleep(this.options.intervalMs, signal);
    }
  }

  /**
   * Reclama un lote y lo entrega.
   *
   * @returns cuántos eventos se procesaron.
   */
  public async drainOnce(): Promise<number> {
    // Primero se cierran las filas que agotaron los intentos y siguen encoladas: si no,
    // ocuparían el sitio de pendientes reales en las métricas y no las reclamaría nadie.
    const closed = await this.queue.finalizeExhausted(this.options.maxAttempts, EXHAUSTED_REASON);
    if (closed > 0) {
      this.logger.error('notificaciones cerradas con los intentos agotados', { count: closed });
    }

    const batch = await this.queue.claimPending(this.options.batchSize, this.options.maxAttempts);
    if (batch.length === 0) {
      return 0;
    }

    // Ventanas de tamaño `concurrency`: `Promise.all` sobre el lote entero abriría
    // tantas conexiones SMTP como eventos haya.
    for (let i = 0; i < batch.length; i += this.options.concurrency) {
      const window = batch.slice(i, i + this.options.concurrency);
      await Promise.all(window.map((item) => this.deliver(item)));
    }
    return batch.length;
  }

  /**
   * Entrega una notificación y registra su desenlace.
   *
   * Nunca lanza: un fallo de un correo no puede tumbar el lote entero, porque los demás
   * ya han sido reclamados y su contador ya subió. Si se propagara, esos eventos se
   * quedarían con un intento gastado y sin desenlace registrado.
   */
  private async deliver(item: ClaimedNotification): Promise<void> {
    const startedAt = Date.now();
    try {
      const { subject, body } = render(item.template, item.payload);
      await this.mailer.send({ to: item.recipient, subject, body });
      this.metrics.observe('email_dispatch', 'success', elapsed(startedAt));
    } catch (err) {
      this.metrics.observe('email_dispatch', 'failure', elapsed(startedAt));
      await this.recordFailure(item, messageOf(err));
      return;
    }

    try {
      await this.queue.markSent(item.eventId, item.attempts);
      this.logger.info('notificación entregada', {
        event_id: item.eventId,
        template: item.template,
        attempts: item.attempts,
      });
    } catch (err) {
      // El correo YA salió pero no se pudo desencolar. La fila sigue pendiente y se
      // reintentará: es un duplicado posible, y es el lado correcto del error —
      // desencolar antes de enviar convertiría este duplicado en una pérdida silenciosa.
      this.logger.error('notificación enviada pero no desencolada; puede reenviarse', {
        event_id: item.eventId,
        error: messageOf(err),
      });
    }
  }

  /**
   * Aplica la transición que corresponda tras un envío fallido.
   *
   * Es la decisión que justifica que exista esta clase:
   *
   * - `attempts < maxAttempts` → la fila sigue en la cola y se reintenta.
   * - `attempts >= maxAttempts` → se desencola y queda como `failed`.
   *
   * El estado `failed` es lo que permite saber que un correo NO se envió; sin él, un
   * fallo permanente sería indistinguible de un evento que nunca llegó.
   */
  private async recordFailure(item: ClaimedNotification, cause: string): Promise<void> {
    const terminal = item.attempts >= this.options.maxAttempts;

    try {
      if (terminal) {
        await this.queue.markFailed(item.eventId, item.attempts, cause);
        this.logger.error('notificación descartada tras agotar los intentos', {
          event_id: item.eventId,
          template: item.template,
          attempts: item.attempts,
          error: cause,
        });
        return;
      }

      await this.queue.recordRetry(item.eventId, item.attempts, cause);
      this.logger.info('envío fallido; se reintentará', {
        event_id: item.eventId,
        attempts: item.attempts,
        error: cause,
      });
    } catch (err) {
      // No se pudo ni registrar el fallo. La fila conserva su contador incrementado, así
      // que el reintento —o el cierre por agotamiento— llegará igual en otro barrido.
      this.logger.error('no se pudo registrar el desenlace de una notificación', {
        event_id: item.eventId,
        error: messageOf(err),
      });
    }
  }
}

/** Segundos transcurridos desde `startedAt`, que es la unidad de Prometheus. */
function elapsed(startedAt: number): number {
  return (Date.now() - startedAt) / 1_000;
}

/** Extrae un mensaje legible de un `unknown` capturado. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Espera `ms`, o menos si llega la señal de parada. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
