/**
 * El documento de bloques: el vocabulario compartido por el lector y el editor
 * (FR-063, FR-068, research D-14).
 *
 * Este archivo es el **espejo en el cliente** del vocabulario que valida el servidor
 * (`services/learning/src/articles/body-doc.validator.ts`). Vive en `shared/` y no dentro
 * de una pantalla porque lo usan las dos mitades del ciclo: el editor para no poder
 * escribir algo que el servidor vaya a rechazar —y para construir el documento que
 * envía— y el lector para interpretar lo que llega.
 *
 * Duplicar el vocabulario sería peor que esto: si el editor tuviera su propia idea de lo
 * que es un documento, el desacuerdo no aparecería en una prueba sino en producción, y se
 * vería como «al guardar dice que el documento no vale» sin decir qué parte no vale.
 *
 * **La regla que no se negocia aquí es la del enlace.** El servidor valida los esquemas de
 * `href` al guardar, y el editor comprueba otra vez antes de insertar uno. No es
 * redundancia: un documento pudo guardarse antes de que existiera el validador (los hay), y
 * una comprobación de seguridad que solo vive en el otro extremo del cable se pierde en el
 * primer cambio de servidor.
 *
 * Lo que este archivo NO hace: no renderiza (eso es el componente), no decide estilos, y no
 * completa lo que falta. Un `alt` ausente no se sustituye por el pie de foto ni por el
 * nombre del archivo.
 */

/** Nodos que existen. Cualquier otro se rechaza al guardar. */
export const BODY_DOC_NODES = [
  'doc',
  'parrafo',
  'encabezado',
  'lista',
  'item_lista',
  'texto',
  'imagen',
  'calculadora',
] as const;

export type BodyDocNodeType = (typeof BODY_DOC_NODES)[number];

/** Marcas admitidas. Nada más: ni subrayado, ni color, ni tamaño. */
export const BODY_DOC_MARKS = ['negrita', 'cursiva', 'enlace'] as const;

export type BodyDocMarkType = (typeof BODY_DOC_MARKS)[number];

/**
 * Niveles de encabezado: empiezan en 2 porque el `h1` de una pantalla es el título de la
 * pantalla, no del artículo. Permitir un `h1` dentro del cuerpo daría dos títulos al mismo
 * documento y rompería la jerarquía que leen los lectores de pantalla (SC-030).
 */
export const BODY_DOC_HEADING_LEVELS = [2, 3, 4] as const;

/** Esquemas que un enlace puede tener. Los mismos que valida el servidor. */
export const BODY_DOC_LINK_SCHEMES = ['http', 'https', 'mailto'] as const;

/** Longitud máxima del `alt`. Un `alt` correcto describe la imagen, no la sustituye. */
export const BODY_DOC_MAX_ALT = 500;

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

/** Un documento válido y vacío — el que tiene un artículo recién creado. */
export const EMPTY_BODY_DOC: BodyDocNode = { tipo: 'doc', contenido: [] };

/** Esquemas de la lista blanca, con dos puntos, como los devuelve `URL`. */
const ESQUEMAS_DE_ENLACE: readonly string[] = BODY_DOC_LINK_SCHEMES.map((esquema) => `${esquema}:`);

/** SHA-256 en hexadecimal: la forma del identificador de una imagen. */
const SHA256 = /^[0-9a-f]{64}$/;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function textoDe(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

/**
 * Interpreta lo que llegó por la red como documento de bloques.
 *
 * Devuelve `null` si no lo es, y `null` es una respuesta legítima: significa «esta versión
 * no tiene documento» y el lector usa el texto plano. Se descarta lo que no encaja **en vez
 * de lanzar**: un documento inválido en la base es un fallo de la capa de escritura —que lo
 * valida al guardar—, y convertir ese fallo en una pantalla de error dejaría al lector sin
 * el artículo, que sigue estando ahí en texto.
 *
 * La comprobación es deliberadamente superficial: se verifica la forma de los nodos que se
 * van a dibujar, no todo el vocabulario. Repetir aquí el validador entero sería mantener
 * dos reglas que se separan con el tiempo; lo que no puede faltar es que ningún nodo
 * desconocido llegue a un `@switch` que no lo espere ni ningún `href` peligroso a un `<a>`.
 */
export function parseBodyDoc(valor: unknown): BodyDocNode | null {
  if (typeof valor === 'string') {
    // El borde lo entrega ya como objeto, pero un documento serializado como cadena es una
    // forma razonable de verlo llegar (es como viaja en el protocolo). Se acepta para no
    // atar la pantalla a la forma exacta del transporte.
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
  if (tipo === undefined || !ES_NODO_CONOCIDO.has(tipo)) {
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
 * ¿Se puede usar este `href`?
 *
 * Se comprueba con `URL` y lista blanca —igual que en el servidor— por el mismo motivo: una
 * lista negra de `javascript:` se salta con `JaVaScRiPt:` o con un tabulador dentro del
 * esquema, así que comparar el texto no sirve; hay que resolver el esquema.
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

/** ¿Es un identificador de imagen con la forma que exige el vocabulario? */
export function isImageId(valor: unknown): valor is string {
  return typeof valor === 'string' && SHA256.test(valor);
}

/**
 * El texto de un documento, sin estructura.
 *
 * Espejo de `bodyDocToPlainText` del servidor, y existe por dos motivos concretos: el
 * formulario necesita saber si el documento está vacío ANTES de enviarlo —para no gastar un
 * viaje en un error previsible—, y una prueba puede comparar las dos implementaciones con
 * las mismas entradas.
 */
export function bodyDocText(doc: BodyDocNode): string {
  return (doc.contenido ?? []).flatMap(lineasDe).join('\n\n');
}

/** Las líneas de un bloque. Una lista aporta una por elemento. */
function lineasDe(nodo: BodyDocNode): string[] {
  if (nodo.tipo === 'texto') {
    return nodo.texto === undefined ? [] : [nodo.texto];
  }
  if (nodo.tipo === 'imagen' || nodo.tipo === 'calculadora') {
    return [];
  }
  if (nodo.tipo === 'parrafo' || nodo.tipo === 'encabezado') {
    const linea = textoDeNodo(nodo).trim();
    return linea === '' ? [] : [linea];
  }
  return (nodo.contenido ?? []).flatMap(lineasDe);
}

/** El texto de un nodo, concatenando sus nodos de texto y sin mirar las marcas. */
function textoDeNodo(nodo: BodyDocNode): string {
  if (nodo.tipo === 'texto') {
    return nodo.texto ?? '';
  }
  if (nodo.tipo === 'imagen' || nodo.tipo === 'calculadora') {
    return '';
  }
  return (nodo.contenido ?? []).map(textoDeNodo).join('');
}

/** ¿Tiene el documento algún bloque? Es la regla del servidor, comprobada antes de enviar. */
export function bodyDocHasBlocks(doc: BodyDocNode): boolean {
  return (doc.contenido ?? []).length > 0;
}

const ES_NODO_CONOCIDO = new Set<string>(BODY_DOC_NODES);
