/**
 * Limpieza de los artículos que crean las pruebas de extremo a extremo (T156).
 *
 * ## Por qué hace falta
 *
 * **No hay endpoint que borre un artículo** —ni versiones—, así que un artículo publicado por una
 * prueba se queda en el catálogo público para siempre: aparece en las capturas de la suite visual,
 * cambia los conteos de las pantallas y ensucia el estado de la siguiente ejecución. Es la misma
 * situación que documenta el hallazgo 10 para `us4-editorial`, con la diferencia de que aquí la
 * prueba puede limpiarse sola.
 *
 * Se borra por SQL con el mismo criterio que `calculators.ts` e `indicators.ts`: es una operación
 * de OPERADOR y no de producto. Añadir a la API un borrado de artículos para que lo use una prueba
 * abriría en el producto algo que nadie más necesita, y borrar un artículo publicado que alguien
 * pueda estar leyendo es justo lo que el flujo editorial existe para impedir.
 *
 * ## El orden importa y es el de las claves ajenas
 *
 * Primero las versiones y después el artículo: `article_versions.article_id` referencia a
 * `articles.id` sin cascada, así que al revés la base rechaza el borrado —y hace bien: un artículo
 * sin versiones es un artículo del que no se puede leer nada—.
 */
import { execFileSync } from 'node:child_process';

/** Prefijo de los títulos que crean las pruebas. Ningún artículo real lo usa. */
export const TEST_ARTICLE_PREFIX = 'Artículo con calculadora';

const CONTAINER = 'fintcart-postgres-learning-1';

/**
 * Borra un artículo de prueba por su título exacto, con todas sus versiones.
 *
 * No falla si no existe: se llama al terminar una prueba, incluso cuando la prueba falló antes de
 * crearlo, y un error aquí taparía el fallo real con un error de limpieza.
 */
export function deleteArticleByTitle(title: string): void {
  if (!title.startsWith(TEST_ARTICLE_PREFIX)) {
    // Salvaguarda: esto corre contra la base de DESARROLLO y un `DELETE` por título con un título
    // que no sea de prueba se llevaría por delante un artículo real.
    throw new Error(`deleteArticleByTitle solo borra artículos de prueba (${TEST_ARTICLE_PREFIX}*)`);
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
      'learning_db',
      '-c',
      `DELETE FROM article_versions
         WHERE article_id IN (SELECT id FROM articles WHERE title = '${title}');
       DELETE FROM articles WHERE title = '${title}';`,
    ],
    { stdio: 'pipe' },
  );
}
