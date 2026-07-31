/**
 * Módulo raíz del Servicio de Aprendizaje.
 *
 * Es la mitad «wiring» del entrypoint: `main.ts` arranca el proceso y este módulo
 * declara el grafo de dependencias que Nest inyecta. Están separados porque son cosas
 * distintas —arrancar un transporte y declarar proveedores— y porque un `AppModule`
 * es lo único que necesita una prueba de integración con `@nestjs/testing`, sin
 * levantar ningún servidor gRPC.
 *
 * Los módulos de dominio (`articles`, `quizzes`, `grading`, `publishing`) se registran
 * aquí conforme llegan sus tareas. Este archivo NO contiene lógica de negocio: si
 * alguna vez aparece un `if` aquí, está en la capa equivocada.
 */
import { Module } from '@nestjs/common';
import { Pool } from 'pg';

// Sin extensión en el import: este paquete compila a CommonJS (`module: commonjs`),
// a diferencia de Notificación, que es ESM y sí la exige.
import { loadConfig, type Config } from './common/config';

/** Token de inyección de la configuración. */
export const CONFIG = Symbol('CONFIG');

/**
 * Token de inyección del pool de PostgreSQL.
 *
 * Se inyecta el POOL y no un cliente: `pg` reutiliza conexiones y cada consulta toma
 * una del pool. Un cliente único compartido serializaría todas las consultas del
 * proceso en una sola conexión.
 */
export const PG_POOL = Symbol('PG_POOL');

@Module({
  providers: [
    {
      provide: CONFIG,
      useFactory: (): Config => loadConfig(),
    },
    {
      provide: PG_POOL,
      inject: [CONFIG],
      useFactory: (config: Config): Pool =>
        new Pool({
          connectionString: config.dbAddr,
          // Cota del pool. El valor por defecto de `pg` es 10 por proceso; con varias
          // réplicas eso agota `max_connections` de PostgreSQL, y el síntoma no es
          // lentitud sino errores de conexión en todo lo que comparta la instancia.
          max: 20,
          // Una conexión inactiva se devuelve al sistema en lugar de retenerse
          // indefinidamente.
          idleTimeoutMillis: 30_000,
          // Sin este plazo, un PostgreSQL inalcanzable deja la petición colgada para
          // siempre en vez de fallar.
          connectionTimeoutMillis: 5_000,
        }),
    },
  ],
  exports: [CONFIG, PG_POOL],
})
export class AppModule {}
