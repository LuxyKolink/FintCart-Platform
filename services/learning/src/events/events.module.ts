/**
 * Módulo del publicador de eventos (Principio V).
 *
 * `EventsPublisher` recibe `amqpAddr` por CONSTRUCTOR y no por inyección directa de
 * `Config`: así queda desacoplado del token de inyección de `DatabaseModule` y una
 * prueba puede construirlo con una URL cualquiera sin montar el módulo entero.
 */
import { Module } from '@nestjs/common';

import { CONFIG, DatabaseModule } from '../common/database.module';
import type { Config } from '../common/config';

import { EventsPublisher } from './publisher';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: EventsPublisher,
      inject: [CONFIG],
      useFactory: (config: Config): EventsPublisher => new EventsPublisher(config.amqpAddr),
    },
  ],
  exports: [EventsPublisher],
})
export class EventsModule {}
