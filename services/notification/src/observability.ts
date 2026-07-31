/**
 * Observabilidad del Servicio de Notificación (§Observabilidad, research D-12).
 *
 * Expone tres cosas en un puerto HTTP propio:
 *
 * - `/healthz` — ¿el proceso está vivo? Kubernetes reinicia el pod si falla.
 * - `/readyz`  — ¿puede trabajar? Kubernetes le quita tráfico si falla.
 * - `/metrics` — latencia, tasa de error y throughput en formato Prometheus.
 *
 * La distinción entre las dos primeras sondas es la que evita el peor fallo operativo
 * de todos: si `/healthz` comprobara la base de datos, una caída de PostgreSQL
 * reiniciaría TODAS las réplicas a la vez, y al volver la base se encontraría con
 * ocho procesos arrancando en frío en lugar de ocho listos para reanudar.
 *
 * Que este servicio abra un puerto HTTP no contradice el Principio II. No hay
 * superficie REST de negocio: son sondas de infraestructura, en un puerto distinto del
 * de servicio, y no exponen ningún dato de dominio.
 *
 * Las métricas se escriben a mano en lugar de traer un cliente de Prometheus: lo que
 * hace falta son un contador y un histograma, y una librería con registries,
 * colectores y push-gateways sería más configuración que la que sustituye.
 */
import { createServer, type Server } from 'node:http';

import type { Logger } from './logger.js';

/**
 * Cotas del histograma de latencia, en segundos.
 *
 * Están elegidas alrededor de SC-007 (95 % de las notificaciones entregadas en menos
 * de dos minutos): sin una cota cerca del objetivo, el percentil que hay que vigilar
 * caería siempre dentro del mismo intervalo y la métrica no distinguiría cumplir de
 * incumplir.
 */
const LATENCY_BUCKETS = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120];

/**
 * Sumidero de métricas.
 *
 * Es una interfaz para que el despachador no dependa del registro concreto: sus
 * pruebas no tienen por qué acumular histogramas para comprobar tres transiciones.
 */
export interface MetricsSink {
  observe(operation: string, outcome: 'success' | 'failure', seconds: number): void;
}

/** Registro de métricas del proceso. */
export class Metrics implements MetricsSink {
  private readonly counts = new Map<string, number>();
  private readonly latencies = new Map<string, number[]>();

  /**
   * Registra el desenlace de una operación y su duración.
   *
   * Throughput y tasa de error salen del mismo contador porque son la misma cuenta
   * partida por `outcome`: registrar dos contadores independientes permitiría que
   * discreparan.
   */
  public observe(operation: string, outcome: 'success' | 'failure', seconds: number): void {
    const key = `${operation}|${outcome}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);

    const samples = this.latencies.get(operation) ?? [];
    samples.push(seconds);
    this.latencies.set(operation, samples);
  }

  /** Serializa el registro en el formato de texto de Prometheus. */
  public render(): string {
    const lines: string[] = [
      '# HELP notification_operations_total Operaciones procesadas por desenlace.',
      '# TYPE notification_operations_total counter',
    ];
    for (const [key, value] of this.counts) {
      const [operation, outcome] = key.split('|');
      lines.push(
        `notification_operations_total{operation="${operation}",outcome="${outcome}"} ${value}`,
      );
    }

    lines.push(
      '# HELP notification_operation_duration_seconds Duración de cada operación.',
      '# TYPE notification_operation_duration_seconds histogram',
    );
    for (const [operation, samples] of this.latencies) {
      let cumulative = 0;
      for (const bound of LATENCY_BUCKETS) {
        cumulative = samples.filter((s) => s <= bound).length;
        lines.push(
          `notification_operation_duration_seconds_bucket{operation="${operation}",le="${bound}"} ${cumulative}`,
        );
      }
      lines.push(
        `notification_operation_duration_seconds_bucket{operation="${operation}",le="+Inf"} ${samples.length}`,
        `notification_operation_duration_seconds_sum{operation="${operation}"} ${samples.reduce((a, b) => a + b, 0)}`,
        `notification_operation_duration_seconds_count{operation="${operation}"} ${samples.length}`,
      );
    }

    return `${lines.join('\n')}\n`;
  }
}

/** Qué debe estar en pie para considerar el proceso listo. */
export interface ReadinessCheck {
  (): Promise<boolean>;
}

/**
 * Arranca el servidor de sondas y métricas.
 *
 * @returns el servidor, para cerrarlo en el apagado ordenado.
 */
export function startProbeServer(
  port: number,
  metrics: Metrics,
  isReady: ReadinessCheck,
  logger: Logger,
): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];

    if (path === '/healthz') {
      // Vivacidad: NO consulta dependencias. Si lo hiciera, una caída de PostgreSQL
      // reiniciaría todas las réplicas a la vez.
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok\n');
      return;
    }

    if (path === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(metrics.render());
      return;
    }

    if (path === '/readyz') {
      void isReady()
        .then((ready) => {
          res
            .writeHead(ready ? 200 : 503, { 'Content-Type': 'text/plain' })
            .end(ready ? 'ready\n' : 'not ready\n');
        })
        .catch((err: unknown) => {
          logger.error('la sonda de readiness falló', {
            error: err instanceof Error ? err.message : String(err),
          });
          res.writeHead(503, { 'Content-Type': 'text/plain' }).end('not ready\n');
        });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found\n');
  });

  server.listen(port, () => logger.info('sondas de salud escuchando', { port }));
  return server;
}
