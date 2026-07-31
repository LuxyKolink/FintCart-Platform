/**
 * Módulo raíz del Servicio de Aprendizaje.
 *
 * Es la mitad «wiring» del entrypoint: `main.ts` arranca el proceso y este módulo
 * COMPONE el grafo. Están separados porque son cosas distintas —arrancar un transporte
 * y declarar proveedores— y porque un `AppModule` es lo único que necesita una prueba
 * de integración con `@nestjs/testing`, sin levantar ningún servidor gRPC.
 *
 * Aquí no se declara ningún proveedor. La configuración y el pool viven en
 * `common/database.module.ts` y las capas del dominio en `grpc/learning.module.ts`:
 * este archivo solo dice qué se ensambla con qué. Si alguna vez aparece un `if` aquí,
 * está en la capa equivocada.
 */
import { Module } from '@nestjs/common';

import { DatabaseModule } from './common/database.module';
import { LearningModule } from './grpc/learning.module';

// Reexportados para que `main.ts` y las pruebas sigan pidiendo los tokens al módulo
// raíz sin tener que saber en qué módulo se declaran.
export { CONFIG, PG_POOL } from './common/database.module';

@Module({
  imports: [DatabaseModule, LearningModule],
  exports: [DatabaseModule],
})
export class AppModule {}
