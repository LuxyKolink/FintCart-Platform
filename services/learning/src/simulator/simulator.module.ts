/**
 * El cliente gRPC del Simulador, visto desde Aprendizaje (T151, D-25).
 *
 * Es el PRIMER cliente gRPC de este servicio: hasta ahora Aprendizaje solo servía. Se declara
 * aquí, en su propio módulo, y no dentro de `LearningModule` porque es una frontera con otro
 * servicio —con su dirección, su contrato y su forma de fallar— y mezclarla con el grafo del
 * dominio haría que el grafo dependiera de que el Simulador esté arriba.
 *
 * ## Lo que este archivo NO hace
 *
 * No lee `simulator_db` (Principio III): la única forma de saber si una calculadora está publicada
 * es preguntárselo a quien la posee. Tampoco decide qué es un error del cliente y qué es un fallo
 * del servidor —eso lo hace el puerto, que es quien conoce la pregunta—, ni cachea: una caché
 * negativa aquí sería una respuesta de hace un minuto a una pregunta que cambia cuando el
 * coordinador aprueba.
 */
import { Module } from '@nestjs/common';
import { ClientGrpc, ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'node:path';

import { CONFIG, DatabaseModule } from '../common/database.module';
import { PublishedCalculators } from '../articles/published-calculators';

import { SIMULATOR_GRPC, SimulatorCalculatorsService } from './simulator-calculators.service';
import type { Config } from '../common/config';

/** Nombre del paquete en el contrato; debe coincidir con el `.proto`. */
const PAQUETE = 'fintcart.simulator.v1';

/** Servicio del contrato que exponen los stubs de `contracts/proto`. */
export const SIMULATOR_SERVICE_NAME = 'SimulatorService';

@Module({
  imports: [
    DatabaseModule,
    ClientsModule.registerAsync([
      {
        name: SIMULATOR_GRPC,
        imports: [DatabaseModule],
        inject: [CONFIG],
        useFactory: (config: Config) => ({
          transport: Transport.GRPC,
          options: {
            // La dirección viene del entorno y es OBLIGATORIA (ver `config.ts`): un valor por
            // defecto apuntaría a un `localhost` que dentro de un contenedor es este mismo
            // proceso, y el síntoma sería «unavailable» con el Simulador perfectamente arrancado.
            url: config.simulatorSvcAddr,
            package: PAQUETE,
            protoPath: [
              join(config.protoDir, 'fintcart', 'simulator', 'v1', 'simulator.proto'),
              // El `.proto` del Simulador importa `common.v1` para `ExpectedRevision` y
              // `OpResult`; sin cargar ese paquete, `@grpc/proto-loader` no resuelve los tipos
              // importados y el cliente no arranca.
              join(config.protoDir, 'fintcart', 'common', 'v1', 'common.proto'),
            ],
            loader: {
              includeDirs: [config.protoDir],
              // Los mismos dos ajustes que el servidor, por los mismos motivos: `int64` como
              // cadena para no perder precisión por encima de 2^53 (Principio VIII) y los
              // nombres de campo tal como se escriben en el `.proto`, sin camelCase, para que
              // un `calculator_id` se lea igual en las cinco implementaciones.
              longs: String,
              keepCase: true,
            },
          },
        }),
      },
    ]),
  ],
  providers: [
    {
      provide: SimulatorCalculatorsService,
      useFactory: (client: ClientGrpc) => new SimulatorCalculatorsService(client),
      inject: [SIMULATOR_GRPC],
    },
    // El dominio pide el PUERTO, no la clase: es lo que permite probar el rechazo de un
    // documento sin que exista un Simulador al otro lado.
    { provide: PublishedCalculators, useExisting: SimulatorCalculatorsService },
  ],
  exports: [PublishedCalculators],
})
export class SimulatorModule {}
