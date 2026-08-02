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
   * Si se exige STARTTLS al servidor SMTP. Por defecto SÍ.
   *
   * Estaba deducido del puerto (`≠ 465 ⇒ STARTTLS`), lo cual es correcto para un
   * proveedor real pero falso para un relé local de desarrollo: MailHog escucha en
   * el 1025 y habla SMTP plano, así que respondía `500 Unrecognised command` y
   * NINGÚN correo de verificación llegaba a salir. Se convierte en una decisión
   * explícita porque el cifrado del correo no debería depender de un número de
   * puerto.
   *
   * El defecto es `true` a propósito: desactivarlo exige escribirlo, de modo que
   * una variable olvidada nunca degrada la conexión en silencio.
   */
  readonly smtpRequireTls: boolean;
  /**
   * Base pública de la SPA, sin barra final (p. ej. `https://app.fintcart.co`).
   *
   * Se usa para componer el enlace de verificación. Es configuración de DESPLIEGUE y
   * no un dato del evento: la misma plataforma se despliega en producción y en
   * pruebas con dominios distintos, y meter la URL en el payload obligaría a que el
   * Orquestador conociera el dominio del frontend.
   *
   * Es obligatoria por eso mismo: con un valor por defecto razonable, un despliegue
   * mal configurado enviaría correos que apuntan a otro entorno —o a localhost— y
   * los enlaces fallarían en manos del usuario, no en el arranque.
   */
  readonly appBaseUrl: string;
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
    APP_BASE_URL: env.APP_BASE_URL,
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
    smtpRequireTls: boolFlag(env.SMTP_REQUIRE_TLS, true, 'SMTP_REQUIRE_TLS'),
    // La barra final se recorta aquí, una vez, en lugar de en cada plantilla: dos
    // sitios que compongan la URL acabarían discrepando en un `//` que unos
    // servidores toleran y otros no.
    appBaseUrl: (required.APP_BASE_URL as string).replace(/\/+$/, ''),
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

/**
 * Interpreta una bandera booleana, o el valor por defecto si la variable no está.
 *
 * Solo admite `true`/`false` literales. La tentación es tratar cualquier cosa que no
 * sea `"true"` como `false`, pero aplicado a un interruptor de TLS eso convierte una
 * errata —`SMTP_REQUIRE_TLS: "ture"`— en una conexión sin cifrar que nadie pidió.
 *
 * @throws {ConfigError} si el valor está presente pero no es `true` ni `false`.
 */
function boolFlag(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized !== 'true' && normalized !== 'false') {
    throw new ConfigError(`${name} debe ser "true" o "false", no ${JSON.stringify(raw)}`);
  }
  return normalized === 'true';
}
