/**
 * Limpieza de los indicadores que crean las pruebas de administración (T108).
 *
 * ## Por qué hace falta y por qué NO se hace por la API
 *
 * La superficie de indicadores no tiene `DELETE` —y es deliberado: una vigencia no se
 * borra, se corrige, porque las simulaciones ya ejecutadas la citan en su snapshot—. Eso
 * deja a la prueba sin forma de deshacer lo que escribió, y una prueba que deja datos
 * cambia el estado del sistema para la siguiente: la lista de vigencias crece en cada
 * ejecución, las capturas visuales enseñan indicadores de prueba y el recorrido por teclado
 * de la barrera de accesibilidad se alarga con cada `Corregir`.
 *
 * Se borra por SQL directo, con el mismo criterio que `roles.ts` usa para conceder un rol:
 * es una operación de OPERADOR, no de producto, y el script de desarrollo ya sabe contra qué
 * contenedor y qué base ejecutarla. La alternativa —añadir un `DELETE` a la API para que la
 * prueba lo use— abriría en el producto una capacidad que nadie más necesita.
 *
 * El borrado es por NOMBRE EXACTO y solo de lo que la prueba creó, con el prefijo `ZZE2E`
 * que ningún indicador real usa.
 */
import { execFileSync } from 'node:child_process';

/** Prefijo de los indicadores que crean las pruebas de extremo a extremo. */
export const TEST_INDICATOR_PREFIX = 'ZZE2E';

const CONTAINER = 'fintcart-postgres-simulator-1';

/**
 * Borra una vigencia por nombre.
 *
 * No falla si el indicador no existe: se llama al terminar una prueba, incluso cuando la
 * prueba falló antes de crearlo, y un error aquí convertiría el fallo real en un error de
 * limpieza que lo tapa.
 */
export function deleteIndicator(name: string): void {
  if (!name.startsWith(TEST_INDICATOR_PREFIX)) {
    // Salvaguarda: un `DELETE` por nombre sobre la tabla de indicadores de la base de
    // desarrollo, con un nombre que no sea de prueba, borraría una cifra real.
    throw new Error(`deleteIndicator solo borra indicadores de prueba (${TEST_INDICATOR_PREFIX}*)`);
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
      `DELETE FROM financial_indicators WHERE name = '${name}';`,
    ],
    { stdio: 'pipe' },
  );
}
