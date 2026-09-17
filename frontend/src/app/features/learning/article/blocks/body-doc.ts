/**
 * El documento de bloques, visto desde el lector (FR-063, FR-068, research D-14).
 *
 * Este archivo es el **espejo de lectura** del vocabulario que valida el servidor
 * (`services/learning/src/articles/body-doc.validator.ts`). No lo duplica por gusto:
 * el cliente no puede confiar en que lo que llega por la red sea lo que él espera, y
 * menos aún cuando el dato viene de una base de datos que ha tenido varias versiones
 * del formato.
 *
 * **La regla que no se negocia aquí es la del enlace.** El servidor valida los esquemas
 * de `href` al guardar, así que en teoría un `javascript:` nunca llega a un documento
 * publicado. En la práctica, la vista no puede depender de esa garantía: un documento
 * pudo guardarse antes de que existiera el validador (y los hay: hay versiones
 * anteriores al documento de bloques y versiones escritas durante la transición), y una
 * comprobación de seguridad que solo vive en el otro extremo del cable es una
 * comprobación que se pierde en el primer cambio de servidor. Aquí se comprueba otra
 * vez, y si el esquema no está entre los admitidos **el nodo no se dibuja como enlace**:
 * se dibuja su texto, sin `href` que nadie pueda pulsar.
 *
 * Lo que este archivo NO hace: no renderiza nada (eso es el componente), no decide
 * estilos, y no completa lo que falta. Un `alt` ausente no se sustituye por el pie de
 * foto ni por el nombre del archivo.
 */

/** Nodos que el lector sabe dibujar. */
export type BodyDocNodeType =
  | 'doc'
  | 'parrafo'
  | 'encabezado'
  | 'lista'
  | 'item_lista'
  | 'texto'
  | 'imagen'
  | 'calculadora';

export interface BodyDocMark {
  readonly tipo: string;
  readonly href?: string;
}

export interface BodyDocNode {
  readonly tipo: BodyDocNodeType;
  readonly contenido?: readonly BodyDocNode[];
  readonly texto?: string;
  readonly marcas?: readonly BodyDocMark[];
  readonly nivel?: number;
  readonly ordenada?: boolean;
  readonly image_id?: string;
  readonly alt?: string;
  readonly pie?: string;
  readonly calculator_id?: string;
  readonly version?: number;
}

/** Esquemas que un enlace puede tener para ser pulsable. Los mismos que valida el servidor. */
const ESQUEMAS_DE_ENLACE = ['http:', 'https:', 'mailto:'];

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function textoDe(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/**
 * Interpreta lo que llegó por la red como documento de bloques.
 *
 * Devuelve `null` si no lo es, y `null` es una respuesta legítima: significa «esta
 * versión no tiene documento» y el lector usa el texto plano. Se descarta lo que no
 * encaja **en vez de lanzar**: un documento inválido en la base es un fallo de la capa
 * de escritura —que lo valida al guardar—, y convertir ese fallo en una pantalla de
 * error dejaría al lector sin el artículo, que sigue estando ahí en texto.
 *
 * La comprobación es deliberadamente superficial: se verifica la forma de los nodos que
 * se van a dibujar, no todo el vocabulario. Repetir aquí el validador entero sería
 * mantener dos reglas que se separan con el tiempo; lo que no puede faltar es que ningún
 * nodo desconocido llegue al `@switch` del componente ni ningún `href` peligroso a un
 * `<a>`.
 */
export function parseBodyDoc(valor: unknown): BodyDocNode | null {
  if (typeof valor === 'string') {
    // El borde lo entrega ya como objeto, pero un documento serializado como cadena es
    // una forma razonable de verlo llegar (es como viaja en el protocolo). Se acepta para
    // no atar la pantalla a la forma exacta del transporte.
    try {
      return parseBodyDoc(JSON.parse(valor) as unknown);
    } catch {
      return null;
    }
  }
  if (!esObjeto(valor) || valor['tipo'] !== 'doc') {
    return null;
  }
  if (!Array.isArray(valor['contenido'])) {
    return null;
  }
  return {
    tipo: 'doc',
    contenido: valor['contenido'].map(parseNodo).filter((nodo): nodo is BodyDocNode => nodo !== null),
  };
}

/** Un nodo suelto, o `null` si no tiene forma de nodo que se pueda dibujar. */
function parseNodo(valor: unknown): BodyDocNode | null {
  if (!esObjeto(valor)) {
    return null;
  }
  const tipo = textoDe(valor['tipo']);
  if (tipo === undefined || !ES_NODO_DIBUJABLE.has(tipo)) {
    return null;
  }

  const contenido = Array.isArray(valor['contenido'])
    ? valor['contenido'].map(parseNodo).filter((hijo): hijo is BodyDocNode => hijo !== null)
    : undefined;

  const marcas = Array.isArray(valor['marcas'])
    ? valor['marcas'].map(parseMarca).filter((marca): marca is BodyDocMark => marca !== null)
    : undefined;

  return {
    tipo: tipo as BodyDocNodeType,
    ...(contenido === undefined ? {} : { contenido }),
    ...(marcas === undefined ? {} : { marcas }),
    ...(textoDe(valor['texto']) === undefined ? {} : { texto: textoDe(valor['texto']) }),
    ...(typeof valor['nivel'] === 'number' ? { nivel: valor['nivel'] } : {}),
    ...(typeof valor['ordenada'] === 'boolean' ? { ordenada: valor['ordenada'] } : {}),
    ...(textoDe(valor['image_id']) === undefined ? {} : { image_id: textoDe(valor['image_id']) }),
    ...(textoDe(valor['alt']) === undefined ? {} : { alt: textoDe(valor['alt']) }),
    ...(textoDe(valor['pie']) === undefined ? {} : { pie: textoDe(valor['pie']) }),
    ...(textoDe(valor['calculator_id']) === undefined
      ? {}
      : { calculator_id: textoDe(valor['calculator_id']) }),
    ...(typeof valor['version'] === 'number' ? { version: valor['version'] } : {}),
  };
}

/** Una marca conocida; las demás se ignoran (el texto se dibuja sin ella, no se pierde). */
function parseMarca(valor: unknown): BodyDocMark | null {
  if (!esObjeto(valor)) {
    return null;
  }
  const tipo = textoDe(valor['tipo']);
  if (tipo !== 'negrita' && tipo !== 'cursiva' && tipo !== 'enlace') {
    return null;
  }
  const href = textoDe(valor['href']);
  return tipo === 'enlace' && href !== undefined ? { tipo, href } : { tipo };
}

/**
 * ¿Se puede pulsar este enlace?
 *
 * Es la comprobación de seguridad del cliente, y se hace con `URL` y lista blanca —igual
 * que en el servidor— por el mismo motivo: una lista negra de `javascript:` se salta con
 * `JaVaScRiPt:` o con un tabulador dentro del esquema.
 */
export function isSafeHref(href: string | undefined): href is string {
  if (href === undefined || href === '') {
    return false;
  }
  try {
    const esquema = new URL(href).protocol.toLowerCase();
    return ESQUEMAS_DE_ENLACE.includes(esquema);
  } catch {
    return false;
  }
}

/** Los niveles de encabezado que un artículo puede tener: el `h1` es de la pantalla. */
export function headingTag(nivel: number | undefined): 'h2' | 'h3' | 'h4' {
  if (nivel === 3) {
    return 'h3';
  }
  if (nivel === 4) {
    return 'h4';
  }
  return 'h2';
}

const ES_NODO_DIBUJABLE = new Set<string>([
  'doc',
  'parrafo',
  'encabezado',
  'lista',
  'item_lista',
  'texto',
  'imagen',
  'calculadora',
]);
