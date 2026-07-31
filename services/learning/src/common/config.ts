/**
 * Configuración del Servicio de Aprendizaje, 100 % desde variables de entorno
 * (Principio X regla 2).
 *
 * No hay fichero de configuración ni valores por defecto para las direcciones: un
 * `DB_ADDR` ausente detiene el arranque en lugar de caer en un `localhost` implícito
 * que en producción apuntaría a la nada —o, peor, a otra cosa.
 *
 * Se lee UNA vez, al arrancar, y el resultado se inyecta. Llamar a `process.env` en
 * mitad de un servicio esconde una dependencia que no aparece en ningún constructor y
 * hace imposible probar ese servicio con otra configuración.
 */
import { resolve } from 'node:path';

import { DEFAULT_HEALTH_PORT } from './observability';

/** Configuración completa del proceso. */
export interface Config {
  /** Cadena de conexión con `learning_db`. */
  readonly dbAddr: string;
  /** Cadena de conexión con RabbitMQ (este servicio es PRODUCTOR, Principio V). */
  readonly amqpAddr: string;
  /** Puerto en el que se sirve gRPC. */
  readonly grpcPort: string;
  /** Nivel de log. */
  /** Puerto de `/healthz`, `/readyz` y `/metrics` (D-12). */
  readonly healthPort: number;
  /** Nivel de log. */
  readonly logLevel: string;
  /**
   * Directorio con los `.proto` de `contracts/`.
   *
   * El transporte gRPC de NestJS los carga en tiempo de EJECUCIÓN con
   * `@grpc/proto-loader`, así que no basta con los stubs generados: el contenedor
   * tiene que llevar también los `.proto`. El `Dockerfile` los copia y fija esta
   * variable; el valor por defecto sirve para ejecutar desde el repo.
   */
  readonly protoDir: string;
}

/** Error de configuración ausente o inválida. */
export class ConfigError extends Error {
  public constructor(message: string) {
    super(`learning: ${message}`);
    this.name = 'ConfigError';
  }
}

/**
 * Lee y valida la configuración del entorno.
 *
 * Reporta TODAS las variables ausentes juntas en lugar de fallar en la primera: con
 * ocho servicios, fallar de una en una convierte un despliegue mal configurado en una
 * tarde de reinicios.
 *
 * @throws {ConfigError} si falta alguna variable obligatoria.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = {
    DB_ADDR: env.DB_ADDR,
    AMQP_ADDR: env.AMQP_ADDR,
    GRPC_PORT: env.GRPC_PORT,
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
    grpcPort: required.GRPC_PORT as string,
    healthPort: healthPort(env.HEALTH_PORT),
    logLevel: env.LOG_LEVEL ?? 'info',
    // `__dirname` apunta a `dist/common` en ejecución, así que se sube dos niveles
    // hasta la raíz del servicio.
    protoDir: env.PROTO_DIR ?? resolve(__dirname, '..', '..', '..', '..', 'contracts', 'proto'),
  };
}

/**
 * Interpreta `HEALTH_PORT`, con valor por defecto.
 *
 * Tiene defecto —al contrario que `GRPC_PORT`, que es obligatorio— porque un despliegue
 * que lo olvide debe quedarse sin sondas, no sin arrancar: negarse a levantar el
 * servicio por su puerto de DIAGNÓSTICO invertiría la relación entre el servicio y lo
 * que lo observa.
 *
 * Un valor ILEGIBLE sí es un error: `HEALTH_PORT: "ocho mil"` caería al defecto y nadie
 * notaría que la configuración pretendida se ignoró.
 *
 * @throws {ConfigError} si el valor está presente pero no es un puerto válido.
 */
function healthPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_HEALTH_PORT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new ConfigError(`HEALTH_PORT debe ser un puerto válido, no ${JSON.stringify(raw)}`);
  }
  return parsed;
}
