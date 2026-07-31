/**
 * Configuración del Servicio de Notificación, 100 % desde variables de entorno
 * (Principio X regla 2).
 *
 * Se lee UNA vez, al arrancar, y el objeto resultante se inyecta por constructor.
 * Un `process.env.SMTP_ADDR` leído en mitad del despachador sería una dependencia
 * invisible en la firma y haría imposible probar el envío contra otro servidor.
 */

/** Configuración completa del proceso. */
export interface Config {
  /** Cadena de conexión con `notification_db`. */
  readonly dbAddr: string;
  /** Cadena de conexión con RabbitMQ (consumidor puro, Principio V). */
  readonly amqpAddr: string;
  /** Cola de la que se consume. */
  readonly queue: string;
  /** `host:puerto` del servidor SMTP. */
  readonly smtpAddr: string;
  /** Remitente de los correos salientes. */
  readonly smtpFrom: string;
  /**
   * Reintentos antes de dar un evento por fallido (FR-024).
   *
   * Al agotarse, el evento sale de `notification_events_queue` y queda en
   * `notification_states` como `failed`. Ese registro es el que permite saber que un
   * correo NO se envió; sin él, un fallo permanente sería indistinguible de un
   * evento que nunca llegó.
   */
  readonly maxAttempts: number;
  /** Milisegundos entre barridos de la cola. */
  readonly dispatchIntervalMs: number;
  /**
   * Cuántas notificaciones se reclaman por barrido.
   *
   * Acota el trabajo de un ciclo: sin tope, el backlog acumulado tras una caída del
   * SMTP se traería entero a memoria en el primer barrido tras recuperarse.
   */
  readonly dispatchBatchSize: number;
  /**
   * Envíos simultáneos como máximo.
   *
   * Sin tope, un lote de mil eventos abriría mil conexiones SMTP a la vez y el
   * proveedor cortaría el tráfico por abuso justo cuando más hay que enviar.
   */
  readonly dispatchConcurrency: number;
  /** Puerto de las sondas `/healthz` y `/readyz` y de `/metrics` (D-12). */
  readonly healthPort: number;
  /** Nivel de log. */
  readonly logLevel: string;
}

/** Error de configuración ausente o inválida. */
export class ConfigError extends Error {
  public constructor(message: string) {
    super(`notification: ${message}`);
    this.name = 'ConfigError';
  }
}

/** Cola por defecto; espeja `events.QueueNotification` del Orquestador. */
const DEFAULT_QUEUE = 'notification.q';

/**
 * Lee y valida la configuración del entorno.
 *
 * Reporta todas las variables ausentes juntas en lugar de fallar en la primera.
 *
 * @throws {ConfigError} si falta una variable obligatoria o un número no es válido.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = {
    DB_ADDR: env.DB_ADDR,
    AMQP_ADDR: env.AMQP_ADDR,
    SMTP_ADDR: env.SMTP_ADDR,
    SMTP_FROM: env.SMTP_FROM,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined || value === '')
    .map(([name]) => name)
    .sort();

  if (missing.length > 0) {
    throw new ConfigError(`faltan variables de entorno obligatorias: ${missing.join(', ')}`);
  }

  return {
    dbAddr: required.DB_ADDR as string,
    amqpAddr: required.AMQP_ADDR as string,
    queue: env.AMQP_QUEUE ?? DEFAULT_QUEUE,
    smtpAddr: required.SMTP_ADDR as string,
    smtpFrom: required.SMTP_FROM as string,
    maxAttempts: positiveInt(env.MAX_ATTEMPTS, 3, 'MAX_ATTEMPTS'),
    dispatchIntervalMs: positiveInt(env.DISPATCH_INTERVAL_MS, 5_000, 'DISPATCH_INTERVAL_MS'),
    dispatchBatchSize: positiveInt(env.DISPATCH_BATCH_SIZE, 50, 'DISPATCH_BATCH_SIZE'),
    dispatchConcurrency: positiveInt(env.DISPATCH_CONCURRENCY, 8, 'DISPATCH_CONCURRENCY'),
    healthPort: positiveInt(env.HEALTH_PORT, 8080, 'HEALTH_PORT'),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}

/**
 * Interpreta un entero positivo, o el valor por defecto si la variable no está.
 *
 * Un valor ILEGIBLE no cae al defecto en silencio: `MAX_ATTEMPTS: "tres"` aplicaría 3
 * y nadie notaría que la configuración pretendida se ignoró. `Number()` además
 * devuelve `0` para la cadena vacía y `NaN` para el texto, dos formas distintas de
 * equivocarse calladamente.
 *
 * @throws {ConfigError} si el valor está presente pero no es un entero positivo.
 */
function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} debe ser un entero positivo, no ${JSON.stringify(raw)}`);
  }
  return parsed;
}
