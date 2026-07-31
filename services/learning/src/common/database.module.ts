/**
 * Configuración y pool de PostgreSQL, en un módulo propio.
 *
 * Vive aparte de `app.module.ts` para romper un ciclo real: los repositorios necesitan
 * el token del pool, y si ese token se declarara en el módulo raíz —que a su vez
 * importa el módulo de los repositorios— el grafo de importaciones se cerraría sobre
 * sí mismo. Con CommonJS eso no siempre falla al compilar; falla en ejecución, con un
 * proveedor `undefined` y un mensaje de Nest que no menciona el ciclo.
 */
import { Module } from '@nestjs/common';
import { Pool } from 'pg';

import { loadConfig, type Config } from './config';

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
export class DatabaseModule {}
