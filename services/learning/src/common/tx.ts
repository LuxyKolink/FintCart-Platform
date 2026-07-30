/**
 * Helper de transacción del Servicio de Aprendizaje (Principio XI regla 4:
 * «escrituras multi-tabla vía helper `execTx`»).
 *
 * Es el equivalente TypeScript del `execTx(ctx, fn)` de los servicios Go y del
 * `exec_tx` de Rust, y existe por la misma razón: que haya UN solo lugar donde se
 * abre, confirma y revierte una transacción.
 *
 * En `pg` el argumento es especialmente concreto. Una transacción exige tomar un
 * cliente del pool con `pool.connect()` y DEVOLVERLO con `client.release()`, siempre,
 * incluso si la consulta lanza. Un `release()` omitido en un camino de error no da
 * ningún síntoma inmediato: la conexión queda retenida y la aplicación se degrada
 * hasta agotar el pool, momento en que toda petición se cuelga esperando un cliente
 * que nunca vuelve. Es el fallo de producción clásico de node-postgres, y el `finally`
 * de este archivo es lo único que hay que revisar para descartarlo.
 *
 * PROHIBIDO `synchronize: true` (Principio XI): el esquema lo fijan las migraciones
 * de `migrations/`, aplicadas con `golang-migrate` (plan.md N-05). Este helper solo
 * ejecuta SQL, nunca lo genera ni altera el esquema.
 */
import type { Pool, PoolClient } from 'pg';

import { storageError } from './errors';

/**
 * Ejecuta `fn` dentro de una transacción: confirma si resuelve, revierte si lanza.
 *
 * La clausura recibe el `PoolClient` y no el `Pool`, y esa es la mitad del valor de la
 * firma: dentro de `fn` no hay forma de escribir fuera de la transacción por descuido.
 * Mezclar una escritura transaccional con otra que va directa al pool produce un
 * estado parcialmente confirmado que ninguna compensación de saga sabe deshacer.
 *
 * @example
 * ```ts
 * const attemptId = await execTx(pool, async (client) => {
 *   const id = await insertAttempt(client, attempt);
 *   await bumpAttemptCounter(client, quizId);
 *   return id;
 * });
 * ```
 */
export async function execTx<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    throw storageError('obtener una conexión del pool', err);
  }

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // El error del ROLLBACK se descarta a propósito y no sustituye al original: el
    // llamador necesita saber por qué falló la operación, no por qué falló el intento
    // de deshacerla. Además, un ROLLBACK que falla suele significar que la conexión ya
    // está muerta, y en ese caso PostgreSQL aborta la transacción por su cuenta.
    try {
      await client.query('ROLLBACK');
    } catch {
      // Intencionadamente vacío: ver el comentario de arriba.
    }
    throw err;
  } finally {
    // SIEMPRE. Es la línea que evita el agotamiento del pool descrito en la cabecera
    // del archivo.
    client.release();
  }
}
