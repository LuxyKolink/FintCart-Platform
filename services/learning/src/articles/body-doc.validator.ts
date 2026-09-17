/**
 * Validador del documento de bloques (T123, FR-063, FR-068, research D-14).
 *
 * Es un validador **negativo**: enumera lo que se admite y rechaza todo lo demás.
 * Ninguna parte de este archivo intenta «limpiar» ni «corregir» un documento; si
 * algo no encaja, la operación falla y se dice por qué y dónde. Un limpiador
 * silencioso convierte un error del cliente en un dato distinto guardado sin
 * avisar, y el cliente se entera dos versiones después.
 *
 * Cada rechazo lleva la **ruta** hasta el nodo culpable (`contenido[1].contenido[3]`),
 * porque el documento lo escribe una máquina y lo depura una persona: «nodo no
 * admitido» sin decir cuál ni dónde obliga a recorrer el árbol a mano, y en un
 * cuerpo real eso es media hora.
 *
 * Lo que este archivo NO hace, a propósito:
 *
 * - **No comprueba que la imagen o la calculadora existan.** Eso es `T128`, y vive
 *   donde se puede comprobar: contra la base de Aprendizaje para las imágenes y por
 *   gRPC contra el Simulador para las calculadoras (T151). Aquí solo se extraen las
 *   referencias, que es lo que aquel paso necesita.
 * - **No conoce `article_images` ni el Simulador**, así que no depende de ninguna
 *   conexión y se puede probar entero sin levantar nada.
 * - **No convierte**: si el `alt` de una imagen falta, no se inventa un texto
 *   alternativo. Un `alt` inventado es peor que ninguno, porque declara ante un
 *   lector de pantalla algo que la imagen no dice.
 */
import { invalidArgument } from '../common/errors';

import {
  BODY_DOC_HEADING_LEVELS,
  BODY_DOC_LINK_SCHEMES,
  BODY_DOC_MARKS,
  BODY_DOC_MAX_ALT,
  BODY_DOC_MAX_DEPTH,
  BODY_DOC_MAX_NODES,
  BODY_DOC_MAX_TEXT,
  BODY_DOC_NODES,
  isBodyDoc,
  type BodyDocMark,
  type BodyDocNode,
  type BodyDocReferences,
} from './body-doc';

const NODES: ReadonlySet<string> = new Set(BODY_DOC_NODES);
const MARKS: ReadonlySet<string> = new Set(BODY_DOC_MARKS);
const LEVELS: ReadonlySet<number> = new Set(BODY_DOC_HEADING_LEVELS);

/** Atributos admitidos por tipo de nodo. Lo que no esté aquí, se rechaza. */
const ATRIBUTOS: Readonly<Record<string, readonly string[]>> = {
  doc: ['tipo', 'contenido'],
  parrafo: ['tipo', 'contenido'],
  encabezado: ['tipo', 'nivel', 'contenido'],
  lista: ['tipo', 'ordenada', 'contenido'],
  item_lista: ['tipo', 'contenido'],
  texto: ['tipo', 'texto', 'marcas'],
  imagen: ['tipo', 'image_id', 'alt', 'pie'],
  calculadora: ['tipo', 'calculator_id', 'version'],
};

/** Nodos que contienen a otros. `texto`, `imagen` y `calculadora` son hojas. */
const CONTENEDORES: ReadonlySet<string> = new Set([
  'doc',
  'parrafo',
  'encabezado',
  'lista',
  'item_lista',
]);

/** Hijos admitidos de un contenedor, para no acabar con un encabezado dentro de una lista. */
const HIJOS: Readonly<Record<string, readonly string[]>> = {
  doc: ['parrafo', 'encabezado', 'lista', 'imagen', 'calculadora'],
  parrafo: ['texto'],
  encabezado: ['texto'],
  lista: ['item_lista'],
  // Un elemento de lista admite los bloques que caben en una viñeta —párrafos,
  // listas anidadas, imágenes y calculadoras— pero NO un encabezado: un `h3`
  // dentro de una viñeta aparecería en el índice del documento como una sección
  // y dejaría el artículo con una estructura que no es la que se ve.
  item_lista: ['parrafo', 'lista', 'imagen', 'calculadora'],
};

/** SHA-256 en hexadecimal, la misma forma que el identificador de `article_images`. */
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Comprueba que `doc` es un documento válido y lo devuelve estrechado.
 *
 * Lanza `invalid_argument` —no `conflict` ni `storage`—: un documento fuera del
 * vocabulario es culpa de quien lo envió, y el borde debe responderle 400, no 500.
 */
export function validateBodyDoc(doc: unknown): BodyDocNode {
  if (!isBodyDoc(doc)) {
    throw invalidArgument(
      'body_doc: la raíz debe ser un objeto {"tipo":"doc","contenido":[…]}; el documento es ' +
        `${describe(doc)}`,
    );
  }

  const estado = { nodos: 0 };
  walk(doc, 'body_doc', 1, estado, undefined);
  return doc;
}

/**
 * Extrae las referencias del documento sin volver a validarlo: quien llama debe
 * haber llamado antes a `validateBodyDoc`. Se separa a propósito para que la
 * extracción sea una lectura del árbol y no un segundo validador con reglas
 * propias que puedan divergir del primero.
 */
export function extractBodyDocReferences(doc: BodyDocNode): BodyDocReferences {
  const imageIds = new Set<string>();
  const calculatorIds = new Set<string>();

  const visitar = (nodo: BodyDocNode): void => {
    if (nodo.tipo === 'imagen' && typeof nodo.image_id === 'string') {
      imageIds.add(nodo.image_id);
    }
    if (nodo.tipo === 'calculadora' && typeof nodo.calculator_id === 'string') {
      calculatorIds.add(nodo.calculator_id);
    }
    for (const hijo of nodo.contenido ?? []) {
      visitar(hijo);
    }
  };

  visitar(doc);
  return { imageIds: [...imageIds], calculatorIds: [...calculatorIds] };
}

/** Recorre el árbol comprobando cada nodo. `ruta` se usa solo para hablar de él. */
function walk(
  nodo: BodyDocNode,
  ruta: string,
  profundidad: number,
  estado: { nodos: number },
  padre: string | undefined,
): void {
  if (profundidad > BODY_DOC_MAX_DEPTH) {
    throw invalidArgument(
      `body_doc: anidamiento mayor de ${BODY_DOC_MAX_DEPTH} niveles en ${ruta}. Sin tope, un ` +
        'documento anidado arbitrariamente cuesta de validar y de renderizar, y el coste lo paga ' +
        'quien abre el artículo',
    );
  }
  if (++estado.nodos > BODY_DOC_MAX_NODES) {
    throw invalidArgument(
      `body_doc: el documento pasa de ${BODY_DOC_MAX_NODES} nodos. Un cuerpo así no es un ` +
        'artículo; suele ser un pegado accidental o un bucle del editor',
    );
  }

  const tipo = nodo.tipo;
  if (typeof tipo !== 'string' || !NODES.has(tipo)) {
    throw invalidArgument(
      `body_doc: nodo ${JSON.stringify(tipo)} no admitido en ${ruta}. Admitidos: ` +
        `${BODY_DOC_NODES.join(', ')}`,
    );
  }

  // El hijo tiene que ser hijo legítimo de su padre. Es lo que impide que un
  // encabezado aparezca dentro de un elemento de lista o que un párrafo cuelgue
  // de otro párrafo, donde ningún renderizador sabría qué hacer con él.
  if (padre !== undefined) {
    const admitidos = HIJOS[padre] ?? [];
    if (!admitidos.includes(tipo)) {
      throw invalidArgument(
        `body_doc: ${JSON.stringify(tipo)} no puede estar dentro de ${JSON.stringify(padre)} ` +
          `(${ruta}); ahí se admiten: ${admitidos.join(', ')}`,
      );
    }
  }

  const admitidos = ATRIBUTOS[tipo] ?? [];
  for (const atributo of Object.keys(nodo)) {
    if (!admitidos.includes(atributo)) {
      throw invalidArgument(
        `body_doc: atributo ${JSON.stringify(atributo)} no admitido en un nodo ${JSON.stringify(tipo)} ` +
          `(${ruta}); admite: ${admitidos.join(', ')}`,
      );
    }
  }

  if (CONTENEDORES.has(tipo)) {
    const contenido = nodo.contenido;
    if (!Array.isArray(contenido)) {
      throw invalidArgument(`body_doc: un nodo ${JSON.stringify(tipo)} necesita "contenido" (${ruta})`);
    }
    for (const [indice, hijo] of contenido.entries()) {
      if (typeof hijo !== 'object' || hijo === null || Array.isArray(hijo)) {
        throw invalidArgument(`body_doc: ${ruta}.contenido[${indice}] no es un nodo`);
      }
      walk(hijo as BodyDocNode, `${ruta}.contenido[${indice}]`, profundidad + 1, estado, tipo);
    }
  }

  switch (tipo) {
    case 'texto':
      validarTexto(nodo, ruta);
      break;
    case 'encabezado':
      if (typeof nodo.nivel !== 'number' || !LEVELS.has(nodo.nivel)) {
        throw invalidArgument(
          `body_doc: un encabezado necesita "nivel" ${BODY_DOC_HEADING_LEVELS.join('/')} (${ruta}); ` +
            'llegan ' + JSON.stringify(nodo.nivel),
        );
      }
      break;
    case 'lista':
      if (typeof nodo.ordenada !== 'boolean') {
        throw invalidArgument(
          `body_doc: una lista necesita "ordenada" verdadero o falso (${ruta}); una lista sin ` +
            'decidir si está ordenada se dibuja distinta según quién la lea',
        );
      }
      break;
    case 'imagen':
      validarImagen(nodo, ruta);
      break;
    case 'calculadora':
      validarCalculadora(nodo, ruta);
      break;
    default:
      break;
  }
}

/** Un nodo de texto: contenido no vacío y marcas conocidas. */
function validarTexto(nodo: BodyDocNode, ruta: string): void {
  if (typeof nodo.texto !== 'string' || nodo.texto === '') {
    throw invalidArgument(`body_doc: un nodo texto necesita "texto" no vacío (${ruta})`);
  }
  if (nodo.texto.length > BODY_DOC_MAX_TEXT) {
    throw invalidArgument(
      `body_doc: un nodo texto de ${nodo.texto.length} caracteres pasa del tope de ` +
        `${BODY_DOC_MAX_TEXT} (${ruta})`,
    );
  }

  if (nodo.marcas === undefined) {
    return;
  }
  if (!Array.isArray(nodo.marcas)) {
    throw invalidArgument(`body_doc: "marcas" debe ser una lista (${ruta})`);
  }
  // El estrechamiento explícito no es cosmético: `Array.isArray` sobre un tipo
  // declarado ensancha a `any[]`, y a partir de ahí cada `.tipo` deja de estar
  // comprobado — justo en el punto donde se decide si una marca entra o no.
  const marcas = nodo.marcas as readonly BodyDocMark[];
  for (const [indice, marca] of marcas.entries()) {
    const donde = `${ruta}.marcas[${indice}]`;
    if (typeof marca !== 'object' || marca === null || Array.isArray(marca)) {
      throw invalidArgument(`body_doc: ${donde} no es una marca`);
    }
    if (typeof marca.tipo !== 'string' || !MARKS.has(marca.tipo)) {
      throw invalidArgument(
        `body_doc: marca ${JSON.stringify(marca.tipo)} no admitida (${donde}). Admitidas: ` +
          `${BODY_DOC_MARKS.join(', ')}`,
      );
    }
    // Los atributos de una marca también se cierran: `enlace` es la única que
    // lleva `href`, y `negrita` con `href` sería un enlace que no se ve como tal.
    const admitidos = marca.tipo === 'enlace' ? ['tipo', 'href'] : ['tipo'];
    for (const atributo of Object.keys(marca)) {
      if (!admitidos.includes(atributo)) {
        throw invalidArgument(
          `body_doc: atributo ${JSON.stringify(atributo)} no admitido en la marca ` +
            `${JSON.stringify(marca.tipo)} (${donde})`,
        );
      }
    }
    if (marca.tipo === 'enlace') {
      validarEnlace(marca.href, donde);
    }
  }
}

/** El `href` es la única superficie de ataque que queda en un documento de bloques (D-14). */
function validarEnlace(href: unknown, donde: string): void {
  if (typeof href !== 'string' || href === '') {
    throw invalidArgument(`body_doc: una marca enlace necesita "href" (${donde})`);
  }
  // El esquema se resuelve con `URL` y se compara contra la lista blanca. Comparar
  // el texto contra listas negras de `javascript:` no sirve: `JaVaScRiPt:` y los
  // espacios de control (`java\tscript:`) son el mismo esquema y no el mismo texto.
  let esquema: string;
  try {
    esquema = new URL(href).protocol;
  } catch (err) {
    throw invalidArgument(`body_doc: "href" no es una URL absoluta (${donde}): ${href}`, err);
  }
  const admitido = BODY_DOC_LINK_SCHEMES.some((s) => `${s}:` === esquema.toLowerCase());
  if (!admitido) {
    throw invalidArgument(
      `body_doc: esquema ${JSON.stringify(esquema)} no admitido en un enlace (${donde}). ` +
        `Admitidos: ${BODY_DOC_LINK_SCHEMES.map((s) => `${s}:`).join(', ')}`,
    );
  }
}

/** Una imagen: identificador de contenido, `alt` obligatorio y pie opcional. */
function validarImagen(nodo: BodyDocNode, ruta: string): void {
  if (typeof nodo.image_id !== 'string' || !SHA256.test(nodo.image_id)) {
    throw invalidArgument(
      `body_doc: una imagen necesita "image_id" con el SHA-256 del contenido en hexadecimal ` +
        `(${ruta}); llega ${JSON.stringify(nodo.image_id)}`,
    );
  }
  if (typeof nodo.alt !== 'string' || nodo.alt.trim() === '') {
    throw invalidArgument(
      `body_doc: una imagen necesita "alt" no vacío (${ruta}). Sin texto alternativo, el artículo ` +
        'es inutilizable con lector de pantalla, y un alt inventado por el servidor sería peor: ' +
        'declararía algo que la imagen no dice',
    );
  }
  if (nodo.alt.length > BODY_DOC_MAX_ALT) {
    throw invalidArgument(
      `body_doc: el "alt" de ${ruta} pasa de ${BODY_DOC_MAX_ALT} caracteres; describe la imagen, ` +
        'no la sustituye',
    );
  }
  if (nodo.pie !== undefined && (typeof nodo.pie !== 'string' || nodo.pie.trim() === '')) {
    throw invalidArgument(`body_doc: el "pie" de ${ruta}, si está, no puede estar vacío`);
  }
}

/** Una calculadora incrustada: referencia y versión fijadas (FR-071). */
function validarCalculadora(nodo: BodyDocNode, ruta: string): void {
  if (typeof nodo.calculator_id !== 'string' || nodo.calculator_id.trim() === '') {
    throw invalidArgument(`body_doc: una calculadora necesita "calculator_id" (${ruta})`);
  }
  if (
    typeof nodo.version !== 'number' ||
    !Number.isInteger(nodo.version) ||
    nodo.version < 1
  ) {
    throw invalidArgument(
      `body_doc: una calculadora necesita "version" entera ≥ 1 (${ruta}); llega ` +
        `${JSON.stringify(nodo.version)}. La versión se fija al incrustar para que editar la ` +
        'calculadora no cambie lo que el artículo publicó',
    );
  }
}

/** Describe un valor para el mensaje de error sin volcar un cuerpo entero al registro. */
function describe(valor: unknown): string {
  if (valor === null) {
    return 'null';
  }
  if (Array.isArray(valor)) {
    return `una lista de ${valor.length} elemento(s)`;
  }
  return typeof valor;
}
