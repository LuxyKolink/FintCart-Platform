/**
 * Observabilidad del Servicio de Aprendizaje (§Observabilidad, research D-12).
 *
 * Aporta las tres cosas que la constitución exige de todos los servicios:
 *
 * - Un `LoggerService` que escribe JSON, para sustituir al logger de consola de Nest.
 *   Los ocho servicios escriben a stdout y un colector los agrega; con texto libre
 *   haría falta una expresión regular por servicio, y se rompe la primera vez que
 *   alguien cambia una palabra del mensaje.
 * - Métricas de latencia, tasa de error y throughput en formato Prometheus.
 * - Sondas `/healthz` y `/readyz`, servidas en un puerto HTTP propio.
 *
 * Que este servicio abra un puerto HTTP **no** contradice el Principio II. `main.ts`
 * arranca con `createMicroservice` justamente para NO tener superficie REST; lo de aquí
 * son sondas de infraestructura en otro puerto, sin ninguna ruta de dominio. La
 * diferencia práctica es que por este puerto no se puede llegar a un artículo ni a un
 * cuestionario, que es lo que el Principio II protege.
 */
import { createServer, type Server } from 'node:http';

import type { LoggerService } from '@nestjs/common';
import type { Pool } from 'pg';

/** Puerto de las sondas cuando `HEALTH_PORT` no está definido. */
export const DEFAULT_HEALTH_PORT = 8080;

/**
 * Cotas del histograma de latencia, en segundos.
 *
 * Elegidas alrededor de SC-002 (respuesta en menos de 500 ms): sin una cota cerca del
 * umbral que se vigila, el percentil caería siempre dentro del mismo intervalo y la
 * métrica no distinguiría cumplir de incumplir.
 */
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const SERVICE = 'learning';

/** Registro de métricas del proceso. */
export class Metrics {
  private readonly counts = new Map<string, number>();
  private readonly latencies = new Map<string, number[]>();

  /**
   * Registra el desenlace de una operación y su duración en segundos.
   *
   * Throughput y tasa de error salen del mismo contador porque son la misma cuenta
   * partida por `outcome`: dos contadores independientes podrían discrepar.
   */
  public observe(operation: string, outcome: string, seconds: number): void {
    const key = `${operation}|${outcome}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);

    const samples = this.latencies.get(operation) ?? [];
    samples.push(seconds);
    this.latencies.set(operation, samples);
  }

  /** Serializa el registro en el formato de texto de Prometheus. */
  public render(): string {
    const lines: string[] = [
      '# HELP fintcart_requests_total Peticiones atendidas, por operación y desenlace.',
      '# TYPE fintcart_requests_total counter',
    ];
    for (const [key, value] of this.counts) {
      const [operation, outcome] = key.split('|');
      lines.push(
        `fintcart_requests_total{service="${SERVICE}",operation="${operation}",code="${outcome}"} ${value}`,
      );
    }

    lines.push(
      '# HELP fintcart_request_duration_seconds Latencia de las operaciones.',
      '# TYPE fintcart_request_duration_seconds histogram',
    );
    for (const [operation, samples] of this.latencies) {
      for (const bound of LATENCY_BUCKETS) {
        const count = samples.filter((s) => s <= bound).length;
        lines.push(
          `fintcart_request_duration_seconds_bucket{service="${SERVICE}",operation="${operation}",le="${bound}"} ${count}`,
        );
      }
      lines.push(
        `fintcart_request_duration_seconds_bucket{service="${SERVICE}",operation="${operation}",le="+Inf"} ${samples.length}`,
        `fintcart_request_duration_seconds_sum{service="${SERVICE}",operation="${operation}"} ${samples.reduce((a, b) => a + b, 0)}`,
        `fintcart_request_duration_seconds_count{service="${SERVICE}",operation="${operation}"} ${samples.length}`,
      );
    }

    return `${lines.join('\n')}\n`;
  }
}

/**
 * Logger JSON compatible con Nest.
 *
 * Sustituye al de consola en `main.ts`. Se implementa a mano en lugar de traer `pino`
 * porque lo que hace falta son cuatro campos fijos y un contexto.
 */
export class JsonLogger implements LoggerService {
  public log(message: unknown, ...optional: unknown[]): void {
    this.write('info', message, optional);
  }

  public error(message: unknown, ...optional: unknown[]): void {
    this.write('error', message, optional);
  }

  public warn(message: unknown, ...optional: unknown[]): void {
    this.write('warn', message, optional);
  }

  public debug(message: unknown, ...optional: unknown[]): void {
    this.write('debug', message, optional);
  }

  public verbose(message: unknown, ...optional: unknown[]): void {
    this.write('debug', message, optional);
  }

  private write(level: string, message: unknown, optional: unknown[]): void {
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      service: SERVICE,
      msg: typeof message === 'string' ? message : JSON.stringify(message),
      // Nest pasa el contexto —el nombre de la clase que registra— como último
      // argumento variádico. Se conserva entero en lugar de interpretarlo: adivinar
      // cuál de los argumentos es el contexto acabaría descartando el resto.
      ...(optional.length > 0 ? { context: optional.map(String) } : {}),
    });

    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }
}

/**
 * Arranca el servidor de sondas y métricas.
 *
 * La distinción entre las dos sondas evita el peor fallo operativo posible: si
 * `/healthz` comprobara PostgreSQL, una caída de la base reiniciaría TODAS las réplicas
 * a la vez y, al volver, se encontraría con procesos arrancando en frío en lugar de con
 * réplicas listas para atender.
 *
 * @returns el servidor, para cerrarlo en el apagado ordenado.
 */
export function startProbeServer(
  port: number,
  metrics: Metrics,
  pool: Pool,
  logger: LoggerService,
): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];

    if (path === '/healthz') {
      // Vivacidad: NO consulta dependencias. Ver arriba.
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok\n');
      return;
    }

    if (path === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(metrics.render());
      return;
    }

    if (path === '/readyz') {
      pool
        .query('SELECT 1')
        .then(() => {
          res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ready\n');
        })
        .catch((err: unknown) => {
          logger.error(
            `learning_db no responde: ${err instanceof Error ? err.message : String(err)}`,
          );
          res.writeHead(503, { 'Content-Type': 'text/plain' }).end('not ready\n');
        });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found\n');
  });

  server.listen(port, () => {
    logger.log(`sondas de salud escuchando en el puerto ${port}`);
  });
  return server;
}
