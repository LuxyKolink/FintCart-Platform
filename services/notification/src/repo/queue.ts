/**
 * Cola persistente CON ESTADO del Servicio de Notificación
 * (Constitución §«Entrega de Notificaciones», plan.md N-04).
 *
 * Son DOS tablas y no una, y la diferencia es el punto entero del diseño:
 *
 * - `notification_events_queue` guarda lo PENDIENTE. Una fila desaparece de aquí en
 *   cuanto el evento alcanza un desenlace terminal.
 * - `notification_states` guarda el RESULTADO, y SOBREVIVE al desencolado. Es lo que
 *   permite responder «ese correo no se envió, y estas fueron las tres veces que se
 *   intentó» meses después.
 *
 * Con una sola tabla habría que elegir entre borrar —y perder la traza— o dejar todo
 * dentro y convertir la cola de pendientes en un histórico que crece sin límite y que
 * hay que filtrar en cada barrido.
 *
 * Las tres transiciones escriben en las dos tablas a la vez, así que van por `execTx`
 * (Principio XI regla 4). Sin transacción, un fallo entre las dos sentencias dejaría
 * el evento fuera de la cola y sin estado registrado: nadie lo volverá a enviar y
 * nadie sabrá que se perdió.
 */
import type { Pool, PoolClient } from 'pg';

import { execTx, RepoError } from './tx.js';

/**
 * Plantillas admitidas, replicadas del CHECK
 * `notification_events_queue_template_valid`.
 *
 * Son las tres y solo tres que el esquema acepta. La unión de tipos hace que añadir
 * una cuarta plantilla sin migrar la base sea un error de compilación en lugar de un
 * `violates check constraint` en ejecución, con el evento ya perdido.
 */
export type TemplateName = 'verificacion' | 'cambio_password' | 'alerta_seguridad';

/**
 * Payload de una notificación.
 *
 * Los valores son `string` SIEMPRE, nunca `number` (Principio VIII). Un payload puede
 * transportar montos o puntajes hacia una plantilla de correo, y el tipo es lo que
 * impide que alguien los convierta «solo para formatear» y pierda centésimas por el
 * camino.
 */
export type NotificationPayload = Readonly<Record<string, string>>;

/** Datos con los que se encola una notificación nueva. */
export interface NewNotification {
  /** `event_id` del sobre de origen. Es la clave de idempotencia. */
  readonly eventId: string;
  readonly recipient: string;
  readonly template: TemplateName;
  readonly payload: NotificationPayload;
}

/** Una notificación pendiente, tal como la reclama el despachador. */
export interface ClaimedNotification extends NewNotification {
  /**
   * Número del intento que se está haciendo AHORA.
   *
   * Ya viene incrementado: la reclamación y el incremento son la misma escritura
   * atómica (ver [[NotificationQueue.claimPending]]).
   */
  readonly attempts: number;
}

/**
 * Contrato de la cola. Se declara como interfaz para que el despachador —donde vive la
 * decisión de reintentar o rendirse— se pueda probar sin PostgreSQL.
 */
export interface NotificationQueue {
  /**
   * Encola un evento y registra su estado inicial `not_sent`.
   *
   * Devuelve `false` si el evento ya estaba encolado o ya se procesó. La entrega del
   * outbox del Orquestador es AT-LEAST-ONCE (D-07), así que recibir el mismo evento
   * dos veces es NORMAL y no puede producir dos correos al usuario.
   */
  enqueue(item: NewNotification): Promise<boolean>;

  /** Reclama hasta `limit` pendientes, incrementando su contador de intentos. */
  claimPending(limit: number, maxAttempts: number): Promise<ClaimedNotification[]>;

  /** Éxito: saca de la cola y deja el estado en `sent`. */
  markSent(eventId: string, attempts: number): Promise<void>;

  /** Fallo reintentable: la fila sigue en la cola; se anota la causa. */
  recordRetry(eventId: string, attempts: number, cause: string): Promise<void>;

  /** Fallo terminal: saca de la cola y deja el estado en `failed`. */
  markFailed(eventId: string, attempts: number, cause: string): Promise<void>;

  /**
   * Cierra las filas que agotaron los intentos y siguen encoladas.
   *
   * Existe por el hueco que deja un proceso que muere entre el último envío fallido y
   * su `markFailed`: esa fila ya no la reclama nadie —está en el máximo— y se quedaría
   * en la cola para siempre, contando como pendiente en las métricas de SC-007.
   */
  finalizeExhausted(maxAttempts: number, cause: string): Promise<number>;
}

/** Estados admitidos por el CHECK `notification_states_state_valid`. */
const STATE_NOT_SENT = 'not_sent';
const STATE_SENT = 'sent';
const STATE_FAILED = 'failed';

/**
 * Reclama un lote INCREMENTANDO el contador en la misma sentencia.
 *
 * Reclamar y contar el intento por separado abriría una ventana en la que dos réplicas
 * del despachador se llevan la misma fila y envían el correo dos veces. Aquí el
 * `UPDATE` es atómico y `FOR UPDATE SKIP LOCKED` reparte el lote entre las réplicas en
 * lugar de hacerlas pelear por la misma fila.
 *
 * `attempts < $2` es además el freno: una fila que agotó los intentos no vuelve a
 * reclamarse jamás, así que un destinatario inválido no se reintenta indefinidamente.
 */
const CLAIM_PENDING_SQL = `
UPDATE notification_events_queue
   SET attempts = attempts + 1
 WHERE id IN (
        SELECT id
          FROM notification_events_queue
         WHERE attempts < $2
         ORDER BY created_at
         LIMIT $1
           FOR UPDATE SKIP LOCKED
       )
RETURNING event_id, recipient, template, payload, attempts`;

const ENQUEUE_SQL = `
INSERT INTO notification_events_queue (event_id, recipient, template, payload)
VALUES ($1, $2, $3, $4)
ON CONFLICT (event_id) DO NOTHING
RETURNING id`;

/**
 * El estado inicial se crea junto con la fila de la cola.
 *
 * Crearlo solo al primer desenlace dejaría un hueco: un evento encolado y aún no
 * intentado no aparecería en `notification_states`, y sería indistinguible de uno que
 * nunca llegó.
 */
const INIT_STATE_SQL = `
INSERT INTO notification_states (event_id, state)
VALUES ($1, '${STATE_NOT_SENT}')
ON CONFLICT (event_id) DO NOTHING`;

const DEQUEUE_SQL = `DELETE FROM notification_events_queue WHERE event_id = $1`;

/**
 * `last_error = NULL` no es cosmético: el CHECK `notification_states_sent_has_no_error`
 * rechaza un `sent` que arrastre el error de un intento anterior.
 */
const MARK_SENT_SQL = `
UPDATE notification_states
   SET state = '${STATE_SENT}', attempts = $2, last_error = NULL, updated_at = now()
 WHERE event_id = $1`;

/** El estado sigue en `not_sent`: el evento no ha terminado, solo ha fallado una vez. */
const RECORD_RETRY_SQL = `
UPDATE notification_states
   SET attempts = $2, last_error = $3, updated_at = now()
 WHERE event_id = $1`;

const MARK_FAILED_SQL = `
UPDATE notification_states
   SET state = '${STATE_FAILED}', attempts = $2, last_error = $3, updated_at = now()
 WHERE event_id = $1`;

const FINALIZE_EXHAUSTED_SQL = `
DELETE FROM notification_events_queue
 WHERE attempts >= $1
RETURNING event_id, attempts`;

/** Fila cruda de la reclamación, antes de convertirse en tipo de dominio. */
interface ClaimedRow {
  readonly event_id: string;
  readonly recipient: string;
  readonly template: TemplateName;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
}

/** Implementación sobre `notification_db`. */
export class PostgresNotificationQueue implements NotificationQueue {
  public constructor(private readonly pool: Pool) {}

  public async enqueue(item: NewNotification): Promise<boolean> {
    return execTx(this.pool, async (client) => {
      try {
        const inserted = await client.query(ENQUEUE_SQL, [
          item.eventId,
          item.recipient,
          item.template,
          JSON.stringify(item.payload),
        ]);
        // `INIT_STATE_SQL` se ejecuta aunque la cola no haya insertado nada: un
        // reproceso de un evento cuyo estado se hubiera perdido lo restablece, y el
        // `ON CONFLICT DO NOTHING` protege el estado ya existente de ser pisado.
        await client.query(INIT_STATE_SQL, [item.eventId]);
        return inserted.rowCount === 1;
      } catch (err) {
        throw new RepoError(`encolar la notificación del evento ${item.eventId}`, err);
      }
    });
  }

  public async claimPending(limit: number, maxAttempts: number): Promise<ClaimedNotification[]> {
    try {
      const result = await this.pool.query<ClaimedRow>(CLAIM_PENDING_SQL, [limit, maxAttempts]);
      return result.rows.map(toClaimed);
    } catch (err) {
      throw new RepoError('reclamar notificaciones pendientes', err);
    }
  }

  public async markSent(eventId: string, attempts: number): Promise<void> {
    await this.settle('marcar como enviada', eventId, async (client) => {
      await client.query(DEQUEUE_SQL, [eventId]);
      await client.query(MARK_SENT_SQL, [eventId, attempts]);
    });
  }

  public async recordRetry(eventId: string, attempts: number, cause: string): Promise<void> {
    // Única transición que NO desencola: la fila sigue pendiente y el próximo barrido
    // la reclama otra vez. El contador ya lo subió la reclamación, así que aquí solo
    // se sincroniza el estado observable.
    await this.settle('registrar el reintento', eventId, async (client) => {
      await client.query(RECORD_RETRY_SQL, [eventId, attempts, cause]);
    });
  }

  public async markFailed(eventId: string, attempts: number, cause: string): Promise<void> {
    await this.settle('marcar como fallida', eventId, async (client) => {
      await client.query(DEQUEUE_SQL, [eventId]);
      await client.query(MARK_FAILED_SQL, [eventId, attempts, cause]);
    });
  }

  public async finalizeExhausted(maxAttempts: number, cause: string): Promise<number> {
    return execTx(this.pool, async (client) => {
      try {
        const removed = await client.query<{ event_id: string; attempts: number }>(
          FINALIZE_EXHAUSTED_SQL,
          [maxAttempts],
        );
        for (const row of removed.rows) {
          await client.query(MARK_FAILED_SQL, [row.event_id, row.attempts, cause]);
        }
        return removed.rowCount ?? 0;
      } catch (err) {
        throw new RepoError('cerrar las notificaciones con los intentos agotados', err);
      }
    });
  }

  /** Envuelve una transición de dos tablas con su transacción y su error. */
  private async settle(
    operation: string,
    eventId: string,
    fn: (client: PoolClient) => Promise<void>,
  ): Promise<void> {
    await execTx(this.pool, async (client) => {
      try {
        await fn(client);
      } catch (err) {
        throw new RepoError(`${operation} (evento ${eventId})`, err);
      }
    });
  }
}

/**
 * Convierte la fila en tipo de dominio (Principio IX regla 3).
 *
 * Los valores del payload se fuerzan a `string`. `pg` devuelve el JSONB ya
 * deserializado, así que un número guardado en la columna llegaría aquí como `number`
 * y se colaría en la plantilla del correo como un `float` — exactamente lo que el
 * Principio VIII prohíbe para importes.
 */
function toClaimed(row: ClaimedRow): ClaimedNotification {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(row.payload ?? {})) {
    payload[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  return {
    eventId: row.event_id,
    recipient: row.recipient,
    template: row.template,
    payload,
    attempts: row.attempts,
  };
}
