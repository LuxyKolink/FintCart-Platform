/**
 * Entrypoint del Servicio de Aprendizaje (Principio X: «entrypoint delgado»).
 *
 * Arranca un microservicio gRPC de NestJS y nada más: la configuración se lee en
 * `common/config.ts`, el grafo de dependencias lo declara `app.module.ts` y el dominio
 * vive en sus módulos. Aquí solo hay transporte y ciclo de vida.
 *
 * **Principio II**: se arranca con `createMicroservice`, NO con `NestFactory.create`.
 * La diferencia importa y no es de estilo: `create` levantaría además un servidor
 * HTTP, y este servicio no tiene superficie REST — el único componente con REST es el
 * API Gateway. Un puerto HTTP abierto «por si acaso» es exactamente el atajo por el
 * que alguien acaba llamando a Aprendizaje sin pasar por el borde.
 *
 * La única excepción es el puerto de SONDAS (`/healthz`, `/readyz`, `/metrics`), que
 * exige la §Observabilidad. Va en un puerto distinto y no expone ninguna ruta de
 * dominio: por ahí no se llega a un artículo ni a un cuestionario, que es justo lo que
 * el Principio II protege.
 */
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { Transport, type MicroserviceOptions } from '@nestjs/microservices';

import { Pool } from 'pg';

import { AppModule, CONFIG, PG_POOL } from './app.module';
import type { Config } from './common/config';
import { JsonLogger, Metrics, startProbeServer } from './common/observability';

/**
 * Paquetes protobuf que sirve este proceso.
 *
 * `fintcart.common.v1` va en la lista aunque no declare ningún servicio: los mensajes
 * de `LearningService` referencian `common.v1.PageRequest` y `common.v1.OpResult`, y
 * sin cargar su paquete `@grpc/proto-loader` no resuelve esos tipos.
 */
const GRPC_PACKAGES = ['fintcart.learning.v1', 'fintcart.common.v1'];

async function bootstrap(): Promise<void> {
  // El módulo construye la configuración, así que se crea el contexto primero y se
  // lee de ahí. Llamar a `loadConfig()` también aquí duplicaría la validación y
  // abriría la puerta a que las dos copias divergieran.
  const logger = new JsonLogger();

  const context = await NestFactory.createApplicationContext(AppModule, { logger });
  const config = context.get<Config>(CONFIG);
  await context.close();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    logger,
    transport: Transport.GRPC,
    options: {
      // `0.0.0.0` y no `localhost`: dentro de un contenedor, escuchar en la interfaz
      // de loopback hace el servicio inalcanzable desde fuera, y el síntoma es
      // «conexión rechazada» desde todos los clientes con el proceso perfectamente
      // arrancado.
      url: `0.0.0.0:${config.grpcPort}`,
      package: GRPC_PACKAGES,
      protoPath: [
        join(config.protoDir, 'fintcart', 'learning', 'v1', 'learning.proto'),
        join(config.protoDir, 'fintcart', 'common', 'v1', 'common.proto'),
      ],
      loader: {
        // `includeDirs` permite que los `import` internos de los `.proto` se resuelvan
        // por su ruta desde la raíz de `contracts/proto`, igual que en `buf`.
        includeDirs: [config.protoDir],
        // `longs: String` es OBLIGATORIO (Principio VIII): sin esto, un `int64` llega
        // como `number` y pierde precisión por encima de 2^53. Los importes ya viajan
        // como `string` decimal por contrato, pero los contadores y las marcas de
        // tiempo también son `int64`.
        longs: String,
        keepCase: true,
      },
    },
  });

  // El apagado ordenado de Nest cierra los proveedores —incluido el pool de `pg`— al
  // recibir SIGTERM. Sin `enableShutdownHooks` no se ejecuta ningún `onModuleDestroy`
  // y el proceso muere con conexiones abiertas.
  app.enableShutdownHooks();

  // Las sondas viven en su propio puerto: si compartieran el de gRPC, retirar tráfico
  // del pod por `/readyz` también dejaría a Kubernetes sin poder consultarlo.
  //
  // El pool se toma del contenedor de Nest y no se abre otro: dos pools contra la misma
  // base duplicarían las conexiones, y la sonda comprobaría la salud de un pool que
  // ningún handler usa — que es tanto como no comprobar nada.
  const probes = startProbeServer(config.healthPort, new Metrics(), app.get<Pool>(PG_POOL), logger);

  await app.listen();

  // El cierre de las sondas se ata a la SEÑAL y no al retorno de `listen`: en un
  // microservicio de Nest, `listen` resuelve en cuanto el transporte está arriba, así
  // que cerrarlas justo después las apagaría un instante después de abrirlas y el pod
  // nunca llegaría a responder `ready`.
  const stopProbes = (): void => {
    probes.close();
  };
  process.once('SIGTERM', stopProbes);
  process.once('SIGINT', stopProbes);
}

bootstrap().catch((err: unknown) => {
  // Se escribe en stderr y no con el logger de Nest porque el fallo puede ser
  // justamente la construcción del contenedor de inyección.
  process.stderr.write(
    `learning: fallo fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exitCode = 1;
});
