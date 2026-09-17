/**
 * Barrera de la ayuda del lenguaje de fórmulas (T160).
 *
 * ## Qué comprueba
 *
 * Que la ayuda que el constructor muestra del lenguaje —`pot` y `potd`— diga lo mismo que
 * `Function::help()` en `services/simulator/src/domain/formula/functions.rs`, que es donde vive el
 * texto autorizado. Las cuatro afirmaciones con consecuencia son:
 *
 *   · `pot` quiere el exponente **entero** y es **exacta**;
 *   · `potd` acepta exponentes **decimales** y es **aproximada**.
 *
 * Una ayuda que miente es peor que no tenerla: el autor de una calculadora confía en ella para
 * decidir con qué función escribe su fórmula, y D-16 dejó escrito que fundir las dos funciones
 * perdería en silencio la exactitud del Principio VIII.
 *
 * ## Por qué una barrera y no un endpoint
 *
 * Lo natural sería servir el catálogo por el contrato y que el frontend lo pintara, y no se hizo
 * porque el contrato no expone el catálogo de funciones y añadirlo es un cambio de contrato
 * entero —proto, tres juegos de stubs, borde y cliente— para dos frases. Mientras eso no exista,
 * la copia se admite **con una comprobación que la hace imposible de divergir**, que es el mismo
 * criterio con el que `tests/seed_regression.rs` acepta la tabla duplicada de las siete semillas.
 *
 * Corre en `npm run lint`, junto a `security-barrier.mjs` y `design-debt.mjs`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(aqui, '..');
const RAIZ = resolve(FRONTEND, '..');

const RUST = resolve(RAIZ, 'services/simulator/src/domain/formula/functions.rs');
const TIPOS = resolve(FRONTEND, 'src/app/features/calculators/builder/formula-help.ts');

/** Qué tiene que afirmar la ayuda de cada función, y con qué palabras del lenguaje. */
const EXIGIDO = [
  { funcion: 'pot', palabras: ['entero', 'exacta'] },
  { funcion: 'potd', palabras: ['decimal', 'aproximada'] },
];

/**
 * El nombre del enumerado en Rust: `pot` → `Pot`, `potd` → `Potd`.
 *
 * Es la única correspondencia que hay que conocer, y va aquí y no en cada uso porque el día que
 * se añada una función a la comprobación —`redondear` → `Redondear`— solo hay que añadirla a
 * [`EXIGIDO`].
 */
function enumDe(funcion) {
  return funcion.charAt(0).toUpperCase() + funcion.slice(1);
}

const rust = readFileSync(RUST, 'utf8');
/**
 * Solo lo que la pantalla MUESTRA: la lista `FORMULA_HELP`.
 *
 * No el archivo entero, y la diferencia se comprobó borrando una palabra del texto visible: con la
 * comprobación sobre todo el archivo, la barrera seguía pasando porque la palabra seguía estando
 * en un comentario. Una barrera que se satisface con un comentario no comprueba lo que el autor de
 * una calculadora va a leer.
 */
function textosVisibles(fuente) {
  const inicio = fuente.toLowerCase().indexOf('export const formula_help');
  return inicio === -1 ? '' : fuente.slice(inicio).toLowerCase();
}

const visibles = textosVisibles(readFileSync(TIPOS, 'utf8'));

/**
 * El cuerpo de `help()`, y no el archivo entero.
 *
 * La primera versión buscaba `Self::Pot => "…"` en todo el archivo y encontraba el de `name()`,
 * que devuelve justo `"pot"` —el nombre, no la ayuda—: la barrera decía que el Simulador había
 * dejado de explicar la función cuando lo único que había pasado es que hay dos sitios que nombran
 * `pot`. Se acota al método que documenta, que es el que tiene la autoridad.
 */
function cuerpoDeLaAyuda(fuente) {
  const inicio = fuente.indexOf('pub const fn help');
  if (inicio === -1) {
    return '';
  }
  // Hasta el cierre del método: dos niveles de sangría desde el inicio de la firma.
  const fin = fuente.indexOf('\n    }', inicio);
  return fin === -1 ? fuente.slice(inicio) : fuente.slice(inicio, fin);
}

const ayuda = cuerpoDeLaAyuda(rust);

const problemas = [];

for (const { funcion, palabras } of EXIGIDO) {
  // El texto autorizado es el de `help()`: `Self::Pot => "pot(base, n) — …"`. Se busca el bloque
  // de esa función hasta el cierre de la expresión, y de ahí se toman las palabras que afirma.
  // El `{?\s*` cubre la forma con llaves —`Self::Potd => { "…" }`, la que usa una ayuda
  // de dos líneas— sin tragarse el resto del brazo: una versión anterior usaba `[^}]*` para
  // «salvar» las llaves y, al ser voraz, se comía el texto siguiente y capturaba el brazo de la
  // función de al lado. Lo cazó la propia barrera, que acusó a `potd` de haber perdido su ayuda:
  // una barrera que falla por su propia expresión regular se arregla en la expresión, no
  // aflojando lo que comprueba.
  const bloque = new RegExp(`Self::${enumDe(funcion)}\\s*=>\\s*\\{?\\s*"([\\s\\S]*?)"`, 'i').exec(ayuda);
  if (bloque === null) {
    problemas.push(`no se encontró la ayuda de \`${funcion}\` en \`help()\` (¿se renombró la función?)`);
    continue;
  }

  const autorizado = bloque[1].toLowerCase();
  for (const palabra of palabras) {
    if (!autorizado.includes(palabra)) {
      // Si el lenguaje dejó de afirmarlo, la ayuda del constructor tiene que dejar de afirmarlo
      // también: esto avisa a quien cambió una de las dos partes.
      problemas.push(
        `la ayuda de \`${funcion}\` en el Simulador ya no dice «${palabra}», así que la del constructor no puede seguir diciéndolo`,
      );
    }
    if (!visibles.includes(palabra)) {
      problemas.push(
        `la ayuda del constructor no dice «${palabra}» de \`${funcion}\`, y el Simulador sí: corregir \`formula-help.ts\``,
      );
    }
  }

  if (!visibles.includes(funcion)) {
    problemas.push(`la ayuda del constructor no nombra \`${funcion}\``);
  }
}

if (problemas.length > 0) {
  console.error('barrera de la ayuda de fórmulas: la ayuda del constructor y la del Simulador discrepan');
  for (const problema of problemas) {
    console.error(`  · ${problema}`);
  }
  process.exit(1);
}

console.log('barrera de la ayuda de fórmulas: pot y potd dicen lo mismo en los dos sitios');
