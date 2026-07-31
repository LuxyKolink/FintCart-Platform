/**
 * Entrypoint del Servicio de Notificación (Principio X: «entrypoint delgado»).
 *
 * Notificación es un CONSUMIDOR PURO (Principio V): no expone gRPC ni REST, así que
 * aquí no hay servidor que arrancar. Lo que hay son dos cosas que corren en paralelo
 * durante toda la vida del proceso:
 *
 *   1. El consumidor de `notification.q`, que ENCOLA cada evento en
 *      `notification_events_queue` y responde el ack (T063).
 *   2. El despachador, que barre esa cola y envía los correos con reintentos (T064).
 *
 * La separación entre las dos no es accidental. Enviar el correo dentro del handler
 * del mensaje ataría el ack de AMQP a la latencia de un servidor SMTP ajeno: un SMTP
 * lento bloquearía el consumo y un SMTP caído devolvería los mensajes a la cola una y
 * otra vez. Con la cola persistente de por medio (plan.md N-04), el ack depende solo
 * de un INSERT y el envío se reintenta a su ritmo.
 *
 * Canal EMAIL únicamente: la bandeja in-app pertenece al Servicio de Usuarios
 * (plan.md N-03).
 */
import amqplib from 'amqplib';
import { Pool } from 'pg';

import { loadConfig, type Config } from './config.js';

/**
 * Prefetch: cuántos mensajes sin confirmar acepta el canal a la vez.
 *
 * Sin límite, el broker empuja toda la cola a este proceso y las demás réplicas se
 * quedan sin nada; y si el proceso muere, todos esos mensajes vuelven de golpe.
 */
const PREFETCH_COUNT = 32;

/** Retroceso entre reintentos de conexión con el broker. */
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

async function main(): Promise<void> {
  const config = loadConfig();

  const pool = new Pool({
    connectionString: config.dbAddr,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Comprobación explícita al arrancar: `new Pool()` no conecta con nada, así que sin
  // esto un `DB_ADDR` equivocado no daría síntoma hasta el primer evento — y ese
  // evento se habría perdido ya.
  await pool.query('SELECT 1');

  const controller = new AbortController();
  installSignalHandlers(controller, config);

  try {
    await consumeForever(pool, config, controller.signal);
  } finally {
    await pool.end();
  }
}

/**
 * Mantiene el consumo vivo reconectando ante fallos del broker.
 *
 * Un consumidor que se rinde tras la primera desconexión deja de notificar sin que
 * nadie se entere: el proceso sigue «arriba», la cola crece y el hueco se descubre
 * cuando alguien pregunta por qué no le llegó el correo de verificación.
 */
async function consumeForever(pool: Pool, config: Config, signal: AbortSignal): Promise<void> {
  let backoff = INITIAL_BACKOFF_MS;

  while (!signal.aborted) {
    try {
      await consumeOnce(pool, config, signal);
      // Una vuelta limpia significa que el apagado fue ordenado.
      return;
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      process.stderr.write(
        `notification: consumo interrumpido (${messageOf(err)}); se reintenta en ${backoff} ms\n`,
      );
      await sleep(backoff, signal);
      // Retroceso exponencial acotado: sin tope, una caída larga del broker llevaría la
      // espera a horas y el servicio tardaría en recuperarse mucho después que RabbitMQ.
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }
}

/** Abre conexión y canal, consume, y devuelve el control cuando algo termina. */
async function consumeOnce(pool: Pool, config: Config, signal: AbortSignal): Promise<void> {
  const connection = await amqplib.connect(config.amqpAddr);
  try {
    const channel = await connection.createChannel();
    await channel.prefetch(PREFETCH_COUNT);

    // La cola NO se declara aquí: la topología completa —exchange, colas, bindings y
    // dead-letter— la declara el Orquestador al arrancar, en un solo sitio.
    // Redeclararla con un parámetro distinto cerraría el canal con un error de
    // equivalencia, y encontrar por qué cuesta mucho más que centralizarla.
    await channel.checkQueue(config.queue);

    // T063 registra aquí el consumidor (`channel.consume`) con el encolado
    // transaccional en `notification_events_queue` + `notification_states`, y T064
    // arranca el despachador con `config.dispatchIntervalMs` y `config.maxAttempts`.
    // Los dos reciben `pool` y `config` por parámetro: este archivo no los construye
    // porque no le corresponde decidir cómo se envía un correo.
    void pool;

    await waitForAbort(signal);
    await channel.close();
  } finally {
    await connection.close();
  }
}

/**
 * Instala el apagado ordenado.
 *
 * SIGTERM es la señal que manda el orquestador de contenedores al retirar un pod.
 * Ignorarla significa morir por SIGKILL nueve segundos después, con un envío a medias
 * y sin cerrar el canal — y un mensaje sin ack vuelve a la cola, así que el correo se
 * enviaría dos veces.
 */
function installSignalHandlers(controller: AbortController, config: Config): void {
  const stop = (): void => {
    if (config.logLevel !== 'silent') {
      process.stdout.write('notification: señal de parada recibida; apagado ordenado\n');
    }
    controller.abort();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

/** Resuelve cuando se aborta la señal. */
function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
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

/**
 * Extrae un mensaje legible de un `unknown` capturado.
 *
 * Existe porque `catch (e)` da `unknown` bajo `useUnknownInCatchVariables`, y
 * `(e as Error).message` produce `undefined` en ejecución cuando alguien lanzó un
 * string — justo en el momento en que más falta hace el mensaje.
 */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((err: unknown) => {
  process.stderr.write(`notification: fallo fatal: ${messageOf(err)}\n`);
  process.exitCode = 1;
});
