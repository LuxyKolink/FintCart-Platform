/**
 * Vocabulario **cerrado** del documento de bloques del artículo (FR-063, FR-068,
 * research D-14).
 *
 * El cuerpo de una versión no es HTML ni texto plano: es un árbol de bloques en
 * JSONB. Este archivo declara **lo único que existe**; `body-doc.validator.ts`
 * comprueba que un documento se ajuste a ello, y el resto del servicio —y el
 * frontend— puede entonces razonar sobre el árbol sin volver a mirar si algo es
 * peligroso.
 *
 * Por qué cerrado y no saneado (la decisión está en D-14, aquí queda el porqué
 * operativo): con HTML, la seguridad depende de configurar bien un saneador y de
 * que nadie añada un `[innerHTML]` «solo para esta vista» dentro de un año. Con un
 * vocabulario cerrado, lo que no está en esta lista **no entra**, y no hay
 * superficie de inyección que sanear porque no hay HTML en ningún punto del
 * recorrido. La diferencia entre las dos posturas no está en el mejor caso: está
 * en lo que pasa cuando alguien tiene prisa.
 *
 * Los `alt` y el pie de foto viven en el nodo `imagen` y **no** en `article_images`
 * (data-model §1.4): pertenecen al uso de la imagen en una versión concreta, no al
 * archivo. Es lo que permite que dos versiones compartan la misma imagen con pies
 * distintos sin duplicar bytes (FR-067).
 */

/** Nodos admitidos. Cualquier otro se rechaza al guardar. */
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

/** Marcas de texto admitidas. Nada más: ni subrayado, ni color, ni tamaño. */
export const BODY_DOC_MARKS = ['negrita', 'cursiva', 'enlace'] as const;

export type BodyDocMarkType = (typeof BODY_DOC_MARKS)[number];

/**
 * Niveles de encabezado admitidos. Empiezan en 2 porque el `h1` de una pantalla
 * es el título de la pantalla, no del artículo: permitir un `h1` dentro del
 * cuerpo daría dos títulos al mismo documento y rompería la jerarquía que leen
 * los lectores de pantalla (SC-030).
 */
export const BODY_DOC_HEADING_LEVELS = [2, 3, 4] as const;

/**
 * Esquemas de enlace admitidos (FR-068). `javascript:` y `data:` se rechazan por
 * lista blanca, no por lista negra: una lista negra de esquemas peligrosos es una
 * carrera que se pierde con el esquema que alguien invente después.
 */
export const BODY_DOC_LINK_SCHEMES = ['http', 'https', 'mailto'] as const;

/**
 * Límites de forma. Existen para que el coste de validar —y de renderizar— esté
 * acotado por construcción y no por la buena voluntad de quien edita: un
 * documento de 500 000 nodos anidados 300 veces no es contenido, es una forma de
 * tumbar el servicio de al lado. Los mismos números que usa el AST de fórmulas
 * (`services/simulator/src/domain/formula/`) por el mismo motivo.
 */
export const BODY_DOC_MAX_DEPTH = 16;
export const BODY_DOC_MAX_NODES = 5_000;
/** Longitud máxima de un nodo de texto. Un párrafo de 200 000 caracteres es un pegado accidental. */
export const BODY_DOC_MAX_TEXT = 20_000;
/** Longitud máxima del `alt`. Un `alt` correcto describe la imagen, no la sustituye. */
export const BODY_DOC_MAX_ALT = 500;

/** Un nodo del documento, tal cual viaja y se persiste. */
export interface BodyDocNode {
  readonly tipo: string;
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
  /** Índice de claves desconocidas: el validador las rechaza, el tipo solo las admite. */
  readonly [atributo: string]: unknown;
}

/** Una marca aplicada a un nodo de texto. */
export interface BodyDocMark {
  readonly tipo: string;
  readonly href?: string;
  readonly [atributo: string]: unknown;
}

/** Referencias que un documento hace al resto del sistema (FR-066, FR-070). */
export interface BodyDocReferences {
  /** Identificadores SHA-256 de las imágenes usadas, sin repetir y en orden de aparición. */
  readonly imageIds: readonly string[];
  /** Identificadores de las calculadoras incrustadas, sin repetir y en orden de aparición. */
  readonly calculatorIds: readonly string[];
}

/** Un documento vacío válido — el que tiene un artículo recién creado. */
export const EMPTY_BODY_DOC: BodyDocNode = { tipo: 'doc', contenido: [] };

/** ¿Es `valor` un documento de bloques con forma de raíz? */
export function isBodyDoc(value: unknown): value is BodyDocNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return (value as BodyDocNode).tipo === 'doc' && Array.isArray((value as BodyDocNode).contenido);
}
