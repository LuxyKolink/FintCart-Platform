/**
 * PostgreSQL 16 REAL para las pruebas de MIGRACIÓN.
 *
 * Por qué existe, y por qué NO usa `pg-mem` como el resto de las pruebas de este
 * servicio: una migración no es una consulta, es un cambio de ESQUEMA con
 * restricciones, conversiones y guardas. `pg-mem` no implementa buena parte de lo
 * que hay que comprobar aquí —índices parciales, `EXCLUDE`, `DO $$` con `RAISE
 * EXCEPTION`, `regexp_split_to_array` sobre el resultado de un `UPDATE … FROM`— y
 * da por bueno lo que no entiende. Es el defecto 17 de 002 con otro traje: una
 * prueba sobre un esquema que no es el de verdad comprueba un esquema que no
 * existe.
 *
 * Cómo se aísla: cada objeto de este arnés crea un **esquema con nombre aleatorio**
 * dentro de la base a la que apunte `MIGRATION_TEST_DB_ADDR` (o, si no está, el
 * `DB_ADDR` del servicio, que es el que ya existe en el contenedor), fija
 * `search_path` a él y aplica los ficheros de `migrations/` **en orden**. Al
 * terminar lo borra con `CASCADE`. Nada de esto toca el esquema `public`, así que
 * se puede correr contra la base de desarrollo con datos dentro.
 *
 * Cómo se ejecuta (el contenedor no tiene la base de datos dentro, la tiene al lado):
 *
 *   docker cp services/learning/test fintcart-learning-1:/app/  # tras editar
 *   docker exec -w /app fintcart-learning-1 npx jest test/migrations
 *
 * Por defecto `npm test` NO las ejecuta: `describeConBaseReal` se convierte en
 * `describe.skip` si no hay base, y lo dice. Es la misma convención que los
 * `#[ignore]` del Simulador: una prueba que necesita infraestructura se declara, no
 * se finge.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

const DIRECTORIO = join(__dirname, '..', '..', 'migrations');

/** Dirección de la base, o `undefined` si no hay ninguna configurada. */
function direccion(): string | undefined {
  return process.env.MIGRATION_TEST_DB_ADDR ?? process.env.DB_ADDR;
}

/** `describe` cuando hay base real; `describe.skip` cuando no, para no fingir. */
export const describeConBaseReal: jest.Describe = direccion()
  ? describe
  : (describe.skip);

/**
 * Una base de datos real con los objetos de `migrations/` aplicados en un esquema
 * propio. Se usa con `await BaseDeMigraciones.crear()` y se cierra en `afterAll`.
 */
export class BaseDeMigraciones {
  public readonly esquema: string;

  private readonly cliente: Client;

  private constructor(cliente: Client, esquema: string) {
    this.cliente = cliente;
    this.esquema = esquema;
  }

  /**
   * Conecta y crea el esquema vacío. NO aplica nada: cada prueba decide hasta
   * dónde llega, porque varias comprueban justo lo que hace UNA migración sobre
   * el estado anterior.
   */
  public static async crear(): Promise<BaseDeMigraciones> {
    const conexion = direccion();
    if (!conexion) {
      throw new Error(
        'no hay base para las pruebas de migración: define MIGRATION_TEST_DB_ADDR o DB_ADDR',
      );
    }
    const cliente = new Client({ connectionString: conexion });
    await cliente.connect();
    const esquema = `mig_${Math.random().toString(16).slice(2, 10)}`;
    await cliente.query(`CREATE SCHEMA ${esquema}`);
    // `search_path` a secas, sin `public`: así una tabla que la migración olvide
    // crear se ve como tal y no se resuelve por accidente contra el esquema real
    // —que es exactamente la trampa que haría pasar esta prueba sin probar nada—.
    await cliente.query(`SET search_path = ${esquema}`);
    return new BaseDeMigraciones(cliente, esquema);
  }

  /** Nombres de las migraciones `up`, en orden. */
  private static ficherosUp(): string[] {
    return readdirSync(DIRECTORIO)
      .filter((n) => n.endsWith('.up.sql'))
      .sort();
  }

  /** Aplica todas las migraciones `up` en orden. */
  public async aplicarTodas(): Promise<void> {
    await this.aplicarHasta(Number.MAX_SAFE_INTEGER);
  }

  /**
   * Aplica las `up` en orden hasta la que empiece por `hasta` (incluida). Sin
   * argumento, todas. Sirve para parar en el estado ANTERIOR a una migración y
   * comprobar qué hace con datos ya dentro.
   */
  public async aplicarHasta(indice: number): Promise<string[]> {
    const aplicadas: string[] = [];
    for (const [i, nombre] of BaseDeMigraciones.ficherosUp().entries()) {
      if (i > indice) break;
      await this.aplicarUna(nombre);
      aplicadas.push(nombre);
    }
    return aplicadas;
  }

  /** Aplica la `up` de una migración concreta, por nombre de archivo. */
  public async aplicarUna(nombre: string): Promise<void> {
    if (!nombre.endsWith('.up.sql')) {
      throw new Error(`se esperaba un fichero .up.sql y llegó «${nombre}»`);
    }
    await this.ejecutarFichero(nombre);
  }

  /** Revierte una migración concreta, por su nombre de `up`. */
  public async revertirUna(nombreUp: string): Promise<void> {
    const down = nombreUp.replace('.up.sql', '.down.sql');
    await this.ejecutarFichero(down);
  }

  /** Revierte TODAS las migraciones, de la última a la primera (T166/T122). */
  public async revertirTodas(): Promise<void> {
    const nombres = BaseDeMigraciones.ficherosUp()
      .map((n) => n.replace('.up.sql', '.down.sql'))
      .reverse();
    for (const nombre of nombres) {
      await this.ejecutarFichero(nombre);
    }
  }

  /** Índice de una migración en la cadena ordenada, por prefijo. */
  public static indiceDe(prefijo: string): number {
    const i = BaseDeMigraciones.ficherosUp().findIndex((n) => n.startsWith(prefijo));
    if (i < 0) throw new Error(`no hay ninguna migración que empiece por «${prefijo}»`);
    return i;
  }

  /**
   * Ejecuta un fichero de migración tal cual. No se envuelve en una transacción
   * propia: los ficheros ya traen su `BEGIN`/`COMMIT`, y envolverlos cambiaría el
   * comportamiento que se quiere medir (una migración que aborta a la mitad debe
   * abortar aquí igual que en `golang-migrate`).
   */
  private async ejecutarFichero(nombre: string): Promise<void> {
    const sql = readFileSync(join(DIRECTORIO, nombre), 'utf8');
    try {
      await this.cliente.query(sql);
    } catch (error) {
      // Un fichero de migración que aborta a la mitad deja la sesión en «transacción
      // abortada»: toda orden posterior falla con «current transaction is aborted»,
      // INCLUIDO el `DROP SCHEMA` de la limpieza —y sin la limpieza el esquema se
      // queda en la base y la siguiente ejecución acumula basura—. Se deshace aquí,
      // en el sitio donde se sabe que hubo un fallo, y no en la limpieza, que no
      // puede saber si llegó a abrirse una transacción.
      await this.limpiarTransaccion();
      throw new Error(
        `la migración ${nombre} falló en el esquema ${this.esquema}: ${(error as Error).message}`,
      );
    }
  }

  /** `ROLLBACK` que no falla nunca: solo sirve para salir de un estado sucio. */
  private async limpiarTransaccion(): Promise<void> {
    try {
      await this.cliente.query('ROLLBACK');
    } catch {
      // Si no había transacción abierta, `ROLLBACK` avisa y no pasa nada.
    }
  }

  /** Consulta devolviendo las filas. */
  public async filas<T extends Record<string, unknown>>(
    sql: string,
    valores: unknown[] = [],
  ): Promise<T[]> {
    const resultado = await this.cliente.query(sql, valores);
    return resultado.rows as T[];
  }

  /** Primera fila, o `undefined`. */
  public async fila<T extends Record<string, unknown>>(
    sql: string,
    valores: unknown[] = [],
  ): Promise<T | undefined> {
    return (await this.filas<T>(sql, valores))[0];
  }

  /**
   * Ejecuta algo que se espera que FALLE por una restricción, y devuelve el mensaje.
   *
   * Acepta una orden suelta o una función —`base.falla(() => base.aplicarUna(x))`—,
   * porque no todo lo que debe fallar es un `INSERT`: una migración que se niega a
   * aplicarse sobre datos que violan su invariante es justo el caso que más importa.
   */
  public async falla(sql: string | (() => Promise<unknown>), valores: unknown[] = []): Promise<string> {
    try {
      if (typeof sql === 'function') {
        await sql();
      } else {
        await this.cliente.query(sql, valores);
      }
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('se esperaba que esto fallara y no falló');
  }

  /** Borra el esquema con todo lo suyo dentro. */
  public async cerrar(): Promise<void> {
    // Se sale de cualquier transacción antes de limpiar: sin esto, un fallo a mitad de
    // una prueba deja la sesión abortada y el `DROP` no llega a ejecutarse (hallazgo 22).
    await this.limpiarTransaccion();
    await this.cliente.query(`DROP SCHEMA IF EXISTS ${this.esquema} CASCADE`);
    await this.cliente.end();
  }
}
