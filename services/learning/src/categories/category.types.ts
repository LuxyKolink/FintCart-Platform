/**
 * Tipos y normalización del agregado «categoría» (FR-032…FR-036).
 *
 * Principio IX regla 3: DTO ≠ dominio ≠ fila. Este archivo declara el dominio
 * ([[Category]]) y la FILA cruda ([[CategoryRow]]); el mapeo entre ambos vive en
 * `category.mapping.ts`, y la conversión dominio → protobuf NO entra en este
 * directorio (`grpc/mapping.ts` es la única frontera donde los tipos generados
 * cruzan hacia el transporte).
 *
 * La normalización de nombre/slug vive aquí y no en la capa de persistencia porque
 * es LÓGICA DE DOMINIO: decide qué dos nombres son «el mismo» y por tanto cuándo una
 * categoría nueva choca con el `name` único de FR-032. Reproduce, para los valores
 * que escribe el administrador, la misma semántica que usó la migración FR-036 al
 * poblar el catálogo (recorte, colapso de espacios y comparación sin tildes ni
 * mayúsculas): si el alta normalizara distinto que la migración, la regla de unicidad
 * tendría dos versiones.
 */

/** Posición de visualización en el catálogo: cardinal de orden, nunca un valor financiero. */
export type Position = number;

/**
 * Categoría del catálogo tal como la expone la capa de aplicación.
 *
 * `slug` es el identificador legible para rutas y filtros, globalmente único y fijo
 * para siempre: no hay RPC de edición de slug, porque reutilizar un slug de una
 * categoría desactivada rompería cualquier ruta o enlace histórico que lo use.
 */
export interface Category {
  readonly categoryId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly position: Position;
  readonly active: boolean;
}

/** Entrada de ALTA validada por el servicio (FR-033). */
export interface CategoryCreateInput {
  readonly name: string;
  /** Vacío ⇒ derivado del nombre. Ya derivado, es inmutable para siempre. */
  readonly slug: string;
  readonly description: string;
  /** ≤ 0 ⇒ se anexa al final del orden activo (el administrador no cuenta posiciones). */
  readonly position: Position;
}

/** Entrada de EDICIÓN validada por el servicio: nombre, descripción y orden (FR-033). */
export interface CategoryUpdateInput {
  readonly name: string;
  readonly description: string;
  readonly position: Position;
}

/** Fila cruda de `categories`; solo la capa de persistencia la construye. */
export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly position: Position;
  readonly active: boolean;
}

/**
 * Forma que PostgreSQL impone a `categories.slug`
 * (`categories_slug_format CHECK`): minúsculas y dígitos separados por un guion.
 */
export const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Clave de comparación de nombres, insensible a mayúsculas, tildes y espacio.
 *
 * Es la versión en JavaScript de `learning_category_key` de la migración FR-036.
 * «Ahorro» y «ahorro», o «Seguridad Financiera» y «seguridad financiera», colapsan
 * a la misma clave; la migración los colapsó así y el alta debe colapsarlos igual
 * para que `name` sea único de verdad (FR-032).
 */
export function normalizeNameKey(raw: string): string {
  // `NFD` separa la base del acento; quitar la franja combinante (U+0300…U+036F) deja
  // la letra sola. Cubre más que la tabla fija de la migración (ñ → n incluida) sin
  // listar caso a caso.
  const fold = raw.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return fold.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Slug derivado de un nombre, en la forma de `categories_slug_format`.
 *
 * «Seguridad Financiera» → `seguridad-financiera`. Devuelve la cadena vacía si el
 * nombre no deja ningún carácter útil (p. ej. solo signos de puntuación); el servicio
 * la rechaza como `invalid_argument`, porque un slug vacío no es una categoría.
 */
export function slugFromName(name: string): string {
  return normalizeNameKey(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
