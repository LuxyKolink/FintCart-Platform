/**
 * Mapeo fila cruda → categoría de dominio (Principio IX regla 3).
 *
 * La FILA (`CategoryRow`, con `id`) la produce solo la capa de persistencia; el DOMINIO
 * ([[Category]], con `categoryId`) es lo que viaja al servicio y al transporte. La
 * conversión dominio → protobuf NO entra en este directorio: vive en
 * `grpc/mapping.ts::categoryToPb`, que es la frontera donde los tipos generados cruzan.
 */
import type { Category, CategoryRow } from './category.types';

/** Fila de `categories` → [[Category]]. */
export function rowToCategory(row: CategoryRow): Category {
  return {
    categoryId: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    position: row.position,
    active: row.active,
  };
}
