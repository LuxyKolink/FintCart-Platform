/**
 * Helper de transacción del Servicio de Notificación (Principio XI regla 4:
 * «escrituras multi-tabla vía helper `execTx`»).
 *
 * En este servicio no es una precaución teórica: la cola de notificaciones son DOS
 * tablas (`notification_events_queue` y `notification_states`, plan.md N-04) y las
 * tres transiciones de T064 escriben en las dos a la vez:
 *
 * - éxito                        → borrar de la cola + `sent` en states
 * - fallo con `attempts < MAX`   → incrementar el contador
 * - fallo con `attempts ≥ MAX`   → borrar de la cola + `failed` en states
 *
 * La primera y la tercera son las que exigen transacción. Sin ella, un fallo entre las
 * dos sentencias deja el evento fuera de la cola y sin estado registrado: nadie lo
 * volverá a enviar y nadie sabrá que se perdió. `notification_states` existe
 * precisamente para sobrevivir al desencolado, y esa garantía se apoya en que las dos
 * escrituras sean atómicas.
 *
 * En `pg` hay además una trampa mecánica: la transacción exige tomar un cliente del
 * pool con `pool.connect()` y devolverlo con `client.release()`, SIEMPRE, incluso si
 * la consulta lanza. Un `release()` omitido en un camino de error no da síntoma
 * inmediato —la conexión queda retenida— hasta que se agota el pool y toda operación
 * se cuelga. El `finally` de este archivo es lo único que hay que revisar para
 * descartarlo.
 *
 * PROHIBIDO `synchronize: true` (Principio XI): el esquema lo fijan las migraciones de
 * `migrations/`, aplicadas con `golang-migrate` (plan.md N-05).
 */
import type { Pool, PoolClient } from 'pg';

/**
 * Error de la capa de persistencia con la causa preservada.
 *
 * Se declara aquí y no en un módulo de errores propio porque este servicio es un
 * CONSUMIDOR PURO (Principio V): no expone gRPC ni REST, así que no hay una capa de
 * transporte que necesite traducir códigos de dominio. Su superficie de error es un
 * log y una decisión de ack/nack, y para eso basta con esto.
 *
 * La causa va en la opción `cause` del constructor de `Error` (ES2022) y no
 * interpolada en el mensaje: un `error: deadlock detected` convertido en texto pierde
 * el `code` de PostgreSQL y el stack, que es lo que hace falta para saber si conviene
 * reintentar (Principio XI regla 6).
 */
export class RepoError extends Error {
  public constructor(operation: string, cause: unknown) {
    super(`notification: fallo de persistencia al ${operation}`, { cause });
    this.name = 'RepoError';
  }
}

/**
 * Ejecuta `fn` dentro de una transacción: confirma si resuelve, revierte si lanza.
 *
 * La clausura recibe el `PoolClient` y no el `Pool`, de modo que dentro de `fn` no hay
 * forma de escribir fuera de la transacción por descuido. Esa es la mitad del valor de
 * la firma: mezclar una escritura transaccional con otra directa al pool produce
 * exactamente el estado parcial que este helper existe para impedir.
 *
 * @example
 * ```ts
 * await execTx(pool, async (client) => {
 *   await dequeue(client, eventId);
 *   await markState(client, eventId, 'sent');
 * });
 * ```
 */
export async function execTx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    throw new RepoError('obtener una conexión del pool', err);
  }

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // El error del ROLLBACK se descarta a propósito y no sustituye al original: el
    // llamador necesita saber por qué falló la operación, no por qué falló el intento
    // de deshacerla. Un ROLLBACK que falla suele significar que la conexión ya está
    // muerta, y en ese caso PostgreSQL aborta la transacción por su cuenta.
    try {
      await client.query('ROLLBACK');
    } catch {
      // Intencionadamente vacío: ver el comentario de arriba.
    }
    throw err;
  } finally {
    // SIEMPRE. Es la línea que evita el agotamiento del pool descrito en la cabecera.
    client.release();
  }
}
