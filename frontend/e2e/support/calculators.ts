/**
 * Limpieza de las calculadoras que crean las pruebas de extremo a extremo (T117–T119).
 *
 * ## Por qué hace falta, y por qué no basta la API
 *
 * La prueba crea una calculadora, la publica y **la ejecuta**, y a partir de ahí no se puede
 * deshacer por la API: `DELETE /calculators/{id}` se niega a borrar una calculadora que alguna
 * simulación del historial cita —y con razón, porque esas filas dejarían de poder explicarse
 * (FR-050)—. Ese rechazo es correcto y no se toca; lo que no puede quedar es el rastro: una
 * calculadora de prueba en el catálogo público cambia el estado para la siguiente ejecución y
 * aparece en las capturas visuales.
 *
 * Se borra por SQL con el mismo criterio que `indicators.ts`: es una operación de OPERADOR, no
 * de producto, el script de desarrollo ya sabe contra qué contenedor y qué base correrla, y
 * añadir a la API una capacidad de borrado forzado para que la use una prueba abriría en el
 * producto algo que nadie más necesita.
 *
 * El borrado va en dos pasos y en ese orden: primero las simulaciones que la citan —las de la
 * prueba, ninguna más— y después la calculadora, que arrastra sus definiciones en cascada.
 */
import { execFileSync } from 'node:child_process';

/** Prefijo de las calculadoras que crean las pruebas. Ninguna calculadora real lo usa. */
export const TEST_CALCULATOR_PREFIX = 'ZZE2E';

const CONTAINER = 'fintcart-postgres-simulator-1';

/**
 * Borra una calculadora de prueba por su nombre exacto, con las simulaciones que la citan.
 *
 * No falla si no existe: se llama al terminar una prueba, incluso cuando la prueba falló antes
 * de crearla, y un error aquí convertiría el fallo real en un error de limpieza que lo tapa.
 */
export function deleteCalculator(name: string): void {
  if (!name.startsWith(TEST_CALCULATOR_PREFIX)) {
    // Salvaguarda: esto corre contra la base de DESARROLLO y un `DELETE` por nombre con un
    // nombre que no sea de prueba se llevaría por delante una calculadora real y su historial.
    throw new Error(`deleteCalculator solo borra calculadoras de prueba (${TEST_CALCULATOR_PREFIX}*)`);
  }

  execFileSync(
    'docker',
    [
      'exec',
      CONTAINER,
      'psql',
      '-U',
      'fintcart',
      '-d',
      'simulator_db',
      '-c',
      // `is_builtin = FALSE` además del nombre: las siete semillas de la plataforma tienen
      // nombres fijos y ninguna empieza por el prefijo, pero una condición de más aquí no
      // cuesta nada y cierra el caso de que alguien renombre una.
      `DELETE FROM simulations
         WHERE calculator_id IN (
           SELECT id FROM calculators WHERE name = '${name}' AND NOT is_builtin
         );
       DELETE FROM calculators WHERE name = '${name}' AND NOT is_builtin;`,
    ],
    { stdio: 'pipe' },
  );
}
