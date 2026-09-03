/**
 * Persistencia del catálogo de categorías (Principio IX: capa `storer`, FR-032…FR-035).
 *
 * Igual que `publishing.repository.ts`, decide AQUÍ dos reglas que necesitan atómica
 * sobre una fila bloqueada y no pueden vivir en la capa de aplicación sin partir una
 * transacción:
 *
 * 1. **Desactivación con rechazo si hay artículos publicados (FR-035)**. Contar en el
 *    servicio y desactivar después dejaría una ventana en la que un artículo publicado
 *    entre las dos consultas se quedaría en una categoría desactivada; el recuento y el
 *    `UPDATE` van en la MISMA transacción.
 * 2. **Intercambio de posición al reordenar**. Las posiciones son únicas entre las
 *    activas y el PATCH es por categoría individual (contrato `gateway-delta.yaml`):
 *    «mover a la posición que ocupa otra» es un INTERCAMBIO, no un conflicto — de lo
 *    contrario ninguna reordenación de dos adyacentes sería expresable con una sola
 *    llamada. Escribir las dos posiciones en dos transacciones podría dejar la pareja
 *    con la misma posición si la segunda falla.
 *
 * La unicidad de NOMBRE insensible a mayúsculas/tildes no la puede imponer PostgreSQL
 * (su índice parcial usa `lower(name)`, que no quita tildes): es regla de la capa de
 * aplicación, y el índice de la base queda como defensa de última línea para la
 * colisión case-insensitive. Aquí, dentro de la transacción de `update`, se comprueba
 * igual para no escribir un nombre duplicado en el mismo movimiento.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { PG_POOL } from '../common/database.module';
import { conflict, DomainError, notFound, storageError } from '../common/errors';
import { execTx } from '../common/tx';

import { rowToCategory } from './category.mapping';
import { normalizeNameKey, type Category, type CategoryRow } from './category.types';

const COLUMNS = `id, name, slug, description, position, active`;

/** Resultado de desactivar: `null` significa que ya estaba inactiva (sin transición). */
export interface Deactivation {
  readonly category: Category;
  readonly changed: boolean;
}

@Injectable()
export class CategoriesRepository {
  public constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Catálogo ordenado. `includeInactive` es la única diferencia entre la vista pública
   * (`ListCategories(include_inactive=false)`) y la de administración.
   *
   * Las activas salen primero, por posición; las inactivas después, también por
   * posición. Así la pantalla de administración puede pintar «activas / desactivadas»
   * con una sola consulta sin reordenar en memoria.
   */
  public async list(includeInactive: boolean): Promise<Category[]> {
    try {
      const sql = includeInactive
        ? `SELECT ${COLUMNS} FROM categories ORDER BY active DESC, position ASC, name ASC`
        : `SELECT ${COLUMNS} FROM categories WHERE active = TRUE ORDER BY position ASC, name ASC`;
      const result = await this.pool.query<CategoryRow>(sql);
      return result.rows.map(rowToCategory);
    } catch (err) {
      throw storageError('listar las categorías', err);
    }
  }

  /** Categoría por identificador, sea cual sea su estado. */
  public async findById(categoryId: string): Promise<Category | null> {
    try {
      const result = await this.pool.query<CategoryRow>(
        `SELECT ${COLUMNS} FROM categories WHERE id = $1`,
        [categoryId],
      );
      const row = result.rows[0];
      return row === undefined ? null : rowToCategory(row);
    } catch (err) {
      throw storageError(`buscar la categoría ${categoryId}`, err);
    }
  }

  /**
   * Alta de una categoría (FR-032/FR-033).
   *
   * La unicidad de nombre/slug/posición la decide antes la capa de aplicación (donde
   * vive la comparación sin tildes); aquí solo se traduce la colisión que el índice de
   * PostgreSQL alcanza a ver bajo una carrera a un `conflict` legible en lugar de un
   * `INTERNAL` opaco.
   */
  public async create(input: {
    name: string;
    slug: string;
    description: string;
    position: number;
  }): Promise<Category> {
    try {
      const result = await this.pool.query<CategoryRow>(
        `INSERT INTO categories (id, name, slug, description, position)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         RETURNING ${COLUMNS}`,
        [input.name, input.slug, input.description, input.position],
      );
      return rowToCategory(mustRow(result.rows[0], 'crear la categoría'));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('ya existe una categoría con ese nombre o identificador (slug)');
      }
      throw storageError('crear la categoría', err);
    }
  }

  /**
   * Edita nombre, descripción y posición de una categoría ACTIVA (FR-033).
   *
   * `position ≤ 0` significa «no la toques»: en proto3 un campo `int32` no distingue
   * ausente de `0`, y una edición solo de nombre no debe mover la categoría al final
   * por accidente. Un `position > 0` que ya ocupe otra activa es un reordenamiento y
   * las dos intercambian posiciones (ver la cabecera).
   */
  public async update(categoryId: string, input: { name: string; description: string; position: number }): Promise<Category> {
    try {
      return await execTx(this.pool, async (client: PoolClient) => {
        const current = await this.lockRow(client, categoryId);
        if (!current.active) {
          throw conflict(`la categoría «${current.name}» está inactiva y no se puede editar`);
        }

        if (normalizeNameKey(current.name) !== normalizeNameKey(input.name)) {
          const duplicate = await this.findActiveWithName(client, categoryId, input.name);
          if (duplicate !== null) {
            throw conflict(`ya existe una categoría activa con el nombre «${duplicate}»`);
          }
        }

        const targetPosition = input.position > 0 ? input.position : current.position;
        if (targetPosition !== current.position) {
          await this.swapPositionIfOccupied(client, categoryId, current.position, targetPosition);
        }

        const updated = await client.query<CategoryRow>(
          `UPDATE categories SET name = $2, description = $3, position = $4
            WHERE id = $1
           RETURNING ${COLUMNS}`,
          [categoryId, input.name, input.description, targetPosition],
        );
        return rowToCategory(mustRow(updated.rows[0], 'editar la categoría'));
      });
    } catch (err) {
      if (err instanceof DomainError) {
        throw err;
      }
      throw storageError(`editar la categoría ${categoryId}`, err);
    }
  }

  /**
   * Desactivación LÓGICA (FR-035): rechaza con el recuento si la categoría tiene
   * artículos publicados, y devuelve `changed: false` si ya estaba inactiva.
   *
   * Devuelve el estado por el que la capa de aplicación decide si publica o no
   * `category.deactivated`: desactivar una categoría ya inactiva es un no-op, y no debe
   * producir un segundo evento.
   */
  public async deactivate(categoryId: string): Promise<Deactivation> {
    try {
      return await execTx(this.pool, async (client: PoolClient) => {
        const current = await this.lockRow(client, categoryId);
        if (!current.active) {
          return { category: rowToCategory(current), changed: false };
        }

        const published = await client.query<{ total: string }>(
          `SELECT count(*) AS total
             FROM articles a
             JOIN article_versions v ON v.id = a.current_version_id
            WHERE a.category_id = $1
              AND v.state = 'publicado'`,
          [categoryId],
        );
        const total = Number.parseInt(published.rows[0]?.total ?? '0', 10);
        if (total > 0) {
          // El recuento va en el mensaje (el único canal que deja la frontera gRPC);
          // el Gateway lo extrae para el `published_count` del 409 (T057). Singular
          // y plural: «1 artículo publicado», no «1 artículos publicados».
          const noun = total === 1 ? 'artículo publicado' : 'artículos publicados';
          throw conflict(
            `no se puede desactivar la categoría «${current.name}»: tiene ${total} ${noun}`,
          );
        }

        const updated = await client.query<CategoryRow>(
          `UPDATE categories SET active = FALSE WHERE id = $1 RETURNING ${COLUMNS}`,
          [categoryId],
        );
        return { category: rowToCategory(mustRow(updated.rows[0], 'desactivar la categoría')), changed: true };
      });
    } catch (err) {
      if (err instanceof DomainError) {
        throw err;
      }
      throw storageError(`desactivar la categoría ${categoryId}`, err);
    }
  }

  /** Fila de la categoría bloqueada, o `not_found`. */
  private async lockRow(client: PoolClient, categoryId: string): Promise<CategoryRow> {
    const result = await client.query<CategoryRow>(
      `SELECT ${COLUMNS} FROM categories WHERE id = $1 FOR UPDATE`,
      [categoryId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw notFound(`no existe la categoría ${categoryId}`);
    }
    return row;
  }

  /** Otra categoría ACTIVA con el mismo nombre normalizado (excluida ella misma). */
  private async findActiveWithName(
    client: PoolClient,
    categoryId: string,
    name: string,
  ): Promise<string | null> {
    const key = normalizeNameKey(name);
    const result = await client.query<{ name: string }>(
      `SELECT name FROM categories WHERE active = TRUE AND id <> $1`,
      [categoryId],
    );
    const hit = result.rows.find((row) => normalizeNameKey(row.name) === key);
    return hit?.name ?? null;
  }

  /**
   * Si otra activa ocupa la posición destino, las dos intercambian: la ocupante pasa a
   * la posición que deja la que se mueve.
   */
  private async swapPositionIfOccupied(
    client: PoolClient,
    categoryId: string,
    fromPosition: number,
    toPosition: number,
  ): Promise<void> {
    const occupant = await client.query<{ id: string }>(
      `SELECT id FROM categories WHERE active = TRUE AND position = $1 AND id <> $2 FOR UPDATE`,
      [toPosition, categoryId],
    );
    const occupantId = occupant.rows[0]?.id;
    if (occupantId === undefined) {
      return;
    }
    await client.query(`UPDATE categories SET position = $2 WHERE id = $1`, [occupantId, fromPosition]);
  }
}

function mustRow(row: CategoryRow | undefined, operation: string): CategoryRow {
  if (row === undefined) {
    throw storageError(operation, new Error('la sentencia no devolvió fila'));
  }
  return row;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}
