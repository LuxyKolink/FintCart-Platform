/**
 * Logs estructurados en JSON (§Observabilidad, research D-12).
 *
 * Una línea por evento y un objeto JSON por línea. El formato no es una preferencia
 * estética: los ocho servicios escriben a stdout y un colector los agrega, y un log de
 * texto libre obliga a mantener expresiones regulares por servicio que se rompen la
 * primera vez que alguien cambia una palabra del mensaje.
 *
 * Se implementa a mano en lugar de traer `pino` o `winston` porque lo que hace falta
 * son tres campos fijos y un objeto de contexto. Una dependencia de log con
 * transportes, serializadores y niveles configurables sería más código de configuración
 * que el que sustituye.
 */

/** Registro mínimo que consumen el despachador y el consumidor. */
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Niveles admitidos, de menos a más severo. */
const LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
type Level = (typeof LEVELS)[number];

/** Log JSON a stdout/stderr. */
export class JSONLogger implements Logger {
  private readonly threshold: number;

  public constructor(
    level: string,
    private readonly service: string,
  ) {
    const index = LEVELS.indexOf(level as Level);
    // Un nivel desconocido cae a `info` en lugar de silenciar el servicio: un
    // `LOG_LEVEL` mal escrito no puede dejar la plataforma sin observabilidad.
    this.threshold = index >= 0 ? index : LEVELS.indexOf('info');
  }

  public info(message: string, fields: Record<string, unknown> = {}): void {
    this.write('info', message, fields);
  }

  public error(message: string, fields: Record<string, unknown> = {}): void {
    this.write('error', message, fields);
  }

  private write(level: Level, message: string, fields: Record<string, unknown>): void {
    if (LEVELS.indexOf(level) < this.threshold) {
      return;
    }

    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      service: this.service,
      msg: message,
      ...fields,
    });

    // Los errores van a stderr para que un despliegue que solo vigile ese flujo siga
    // viendo lo que falla.
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }
}
