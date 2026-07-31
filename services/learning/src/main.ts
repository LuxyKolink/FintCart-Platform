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
 */
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { Transport, type MicroserviceOptions } from '@nestjs/microservices';

import { AppModule, CONFIG } from './app.module';
import type { Config } from './common/config';

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
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const config = context.get<Config>(CONFIG);
  await context.close();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
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

  await app.listen();
}

bootstrap().catch((err: unknown) => {
  // Se escribe en stderr y no con el logger de Nest porque el fallo puede ser
  // justamente la construcción del contenedor de inyección.
  process.stderr.write(`learning: fallo fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
