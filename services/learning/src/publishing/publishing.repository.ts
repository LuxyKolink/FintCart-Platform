/**
 * Persistencia del flujo editorial (Principio IX: capa `storer`).
 *
 * Habla SQL y tipos de fila, igual que `articles/articles.repository.ts` y
 * `quizzes/quizzes.repository.ts`. La regla de separación de responsabilidades
 * (FR-008, `approved_by ≠ created_by`) está DUPLICADA a propósito: la impone el CHECK
 * `article_versions_approver_differs_from_author` en el esquema (defensa de última
 * línea) y también [[PublishingRepository.approveAndPublish]] ANTES de escribir
 * (defensa que produce un error de dominio legible en lugar de una violación de CHECK
 * genérica que la capa gRPC traduciría a `INTERNAL`).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { PG_POOL } from '../common/database.module';
import type { Count } from '../common/counts';
import { DomainError, conflict, forbidden, notFound, storageError } from '../common/errors';
import type { Page } from '../common/pagination';
import { execTx } from '../common/tx';

/** Fila de `article_versions`. */
export interface VersionRow {
  readonly versionId: string;
  readonly articleId: string;
  readonly versionNo: Count;
  readonly body: string;
  readonly state: string;
  readonly createdBy: string;
  readonly approvedBy: string;
  readonly createdAt: string;
  readonly publishedAt: string;
}

/** Página de resultados con su total. */
export interface Paged<T> {
  readonly items: readonly T[];
  readonly total: Count;
}

/**
 * Versión recién publicada, con `title`/`category` del artículo — viven en `articles`,
 * no en `article_versions`, y hacen falta para el payload de `learning.article_published`
 * (T163, `events-catalog.md`).
 */
export interface PublishedVersion extends VersionRow {
  readonly title: string;
  readonly category: string;
}

/** Filtro de [[PublishingRepository.listVersions]] — cadena vacía = sin filtrar. */
export interface VersionFilter {
  readonly articleId: string;
  readonly state: string;
  readonly editorId: string;
}

interface RawRow {
  readonly id: string;
  readonly article_id: string;
  readonly version_no: Count;
  readonly body: string;
  readonly state: string;
  readonly created_by: string;
  readonly approved_by: string | null;
  readonly created_at: Date;
  readonly published_at: Date | null;
}

const COLUMNS = `id, article_id, version_no, body, state, created_by, approved_by, created_at, published_at`;

// `id` sale de `gen_random_uuid()` EXPLÍCITO en el `VALUES` y no del `DEFAULT` de la
// columna: el `DEFAULT` es correcto en PostgreSQL real, pero pg-mem (usado en las
// pruebas de persistencia, T171) no lo reproduce en todas las tablas de su esquema de
// prueba, y depender de él aquí acoplaría el SQL de producción a una particularidad del
// doble de pruebas.
const INSERT_ARTICLE_SQL = `
INSERT INTO articles (id, title, category, author_id) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`;

const INSERT_FIRST_VERSION_SQL = `
INSERT INTO article_versions (id, article_id, version_no, body, created_by)
VALUES (gen_random_uuid(), $1, 1, $2, $3)
RETURNING ${COLUMNS}`;

/**
 * Bloquea el ARTÍCULO (no una fila de `article_versions`, que aún no existe) para que
 * dos peticiones concurrentes de nueva versión del mismo artículo no calculen el mismo
 * `MAX(version_no)` y choquen contra `UNIQUE (article_id, version_no)`. Una fallaría con
 * un error de unicidad opaco en lugar de con `not_found`/`conflict` legible.
 */
const LOCK_ARTICLE_SQL = `SELECT id FROM articles WHERE id = $1 FOR UPDATE`;

const NEXT_VERSION_NO_SQL = `
SELECT COALESCE(MAX(version_no), 0) + 1 AS next_no FROM article_versions WHERE article_id = $1`;

const INSERT_NEW_VERSION_SQL = `
INSERT INTO article_versions (id, article_id, version_no, body, created_by)
VALUES (gen_random_uuid(), $1, $2, $3, $4)
RETURNING ${COLUMNS}`;

const FIND_VERSION_FOR_UPDATE_SQL = `SELECT ${COLUMNS} FROM article_versions WHERE id = $1 FOR UPDATE`;

const UPDATE_DRAFT_BODY_SQL = `
UPDATE article_versions
   SET body = $3
 WHERE id = $1 AND created_by = $2 AND state = 'borrador'
RETURNING ${COLUMNS}`;

const SUBMIT_FOR_REVIEW_SQL = `
UPDATE article_versions
   SET state = 'en_revision'
 WHERE id = $1 AND created_by = $2 AND state = 'borrador'
RETURNING ${COLUMNS}`;

const PUBLISH_VERSION_SQL = `
UPDATE article_versions
   SET state = 'publicado', approved_by = $2, published_at = now()
 WHERE id = $1 AND state = 'en_revision'
RETURNING ${COLUMNS}`;

const SET_CURRENT_VERSION_SQL = `
UPDATE articles SET current_version_id = $2 WHERE id = $1
RETURNING title, category`;

const ARCHIVE_VERSION_SQL = `
UPDATE article_versions
   SET state = 'archivado'
 WHERE id = $1 AND state = 'publicado'
RETURNING ${COLUMNS}`;

/**
 * `$1::uuid IS NULL` / `$3::uuid IS NULL` para los filtros de identificador y
 * `$2 = ''` para el de estado — la misma convención partida que ya usa
 * `quizzes.repository.ts::LIST_ATTEMPTS_SQL`: los filtros de UUID viajan como `null`
 * (una cadena vacía no es un UUID válido para el cast), el de texto como `''`.
 */
const LIST_VERSIONS_SQL = `
SELECT ${COLUMNS}
  FROM article_versions
 WHERE ($1::uuid IS NULL OR article_id = $1::uuid)
   AND ($2 = '' OR state = $2)
   AND ($3::uuid IS NULL OR created_by = $3::uuid)
 ORDER BY created_at DESC, id DESC
 LIMIT $4 OFFSET $5`;

const COUNT_VERSIONS_SQL = `
SELECT count(*) AS total
  FROM article_versions
 WHERE ($1::uuid IS NULL OR article_id = $1::uuid)
   AND ($2 = '' OR state = $2)
   AND ($3::uuid IS NULL OR created_by = $3::uuid)`;

@Injectable()
export class PublishingRepository {
  public constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Artículo NUEVO con su versión 1 en `borrador` (FR-007). */
  public async createArticle(title: string, category: string, body: string, editorId: string): Promise<VersionRow> {
    try {
      return await execTx(this.pool, async (client: PoolClient) => {
        const article = await client.query<{ id: string }>(INSERT_ARTICLE_SQL, [title, category, editorId]);
        const articleId = article.rows[0]?.id;
        if (articleId === undefined) {
          throw storageError('crear el artículo', new Error('el INSERT no devolvió fila'));
        }
        const version = await client.query<RawRow>(INSERT_FIRST_VERSION_SQL, [articleId, body, editorId]);
        return toVersion(mustRow(version.rows[0], 'crear la primera versión'));
      });
    } catch (err) {
      if (err instanceof DomainError) {
        throw err;
      }
      throw storageError('crear el artículo', err);
    }
  }

  /**
   * Nueva versión en `borrador` de un artículo YA PUBLICADO (FR-013).
   *
   * El bloqueo de [[LOCK_ARTICLE_SQL]] y el cálculo de `version_no` van en la MISMA
   * transacción: sin él, dos editores pidiendo una nueva versión a la vez verían el
   * mismo `MAX` y uno de los dos perdería con una violación de unicidad en lugar de
   * obtener la versión 2 y la 3 respectivamente.
   */
  public async createNewVersion(articleId: string, editorId: string, body: string): Promise<VersionRow> {
    try {
      return await execTx(this.pool, async (client: PoolClient) => {
        const locked = await client.query<{ id: string }>(LOCK_ARTICLE_SQL, [articleId]);
        if (locked.rows[0] === undefined) {
          throw notFound(`no existe el artículo ${articleId}`);
        }

        const next = await client.query<{ next_no: Count }>(NEXT_VERSION_NO_SQL, [articleId]);
        const inserted = await client.query<RawRow>(INSERT_NEW_VERSION_SQL, [
          articleId,
          next.rows[0]?.next_no ?? 1,
          body,
          editorId,
        ]);
        return toVersion(mustRow(inserted.rows[0], 'crear la nueva versión'));
      });
    } catch (err) {
      if (err instanceof DomainError) {
        throw err;
      }
      throw storageError(`crear una nueva versión de ${articleId}`, err);
    }
  }

  /**
   * Edita el CUERPO de una versión en `borrador` (FR-007). `editorId` restringe a su
   * propio autor — la misma barrera que `MarkNotificationRead` de Usuarios usa contra
   * un identificador ajeno: un `borrador` es visible únicamente a su editor (FR-008), y
   * dejar que cualquier editor lo edite conociendo el `version_id` violaría eso.
   *
   * @throws {DomainError} `not_found` si la versión no existe, no es suya, o `conflict`
   *   si ya no está en `borrador`.
   */
  public async updateDraftBody(versionId: string, editorId: string, body: string): Promise<VersionRow> {
    try {
      const result = await this.pool.query<RawRow>(UPDATE_DRAFT_BODY_SQL, [versionId, editorId, body]);
      const row = result.rows[0];
      if (row !== undefined) {
        return toVersion(row);
      }
      throw notFound(`no existe un borrador propio con id ${versionId}`);
    } catch (err) {
      if (err instanceof DomainError) {
        throw err;
      }
      throw storageError(`editar el borrador ${versionId}`, err);
    }
  }

  /** `borrador → en_revision` (FR-008). */
  public async submitForReview(versionId: string, editorId: string): Promise<VersionRow> {
    try {
      const result = await this.pool.query<RawRow>(SUBMIT_FOR_REVIEW_SQL, [versionId, editorId]);
      const row = result.rows[0];
      if (row !== undefined) {
        return toVersion(row);
      }
      throw notFound(`no existe un borrador propio con id ${versionId}`);
    } catch (err) {
      if (err instanceof DomainError) {
        throw err;
      }
      throw storageError(`enviar a revisión ${versionId}`, err);
    }
  }

  /**
   * `en_revision → publicado` (FR-008), actualizando `articles.current_version_id` en
   * la MISMA transacción: un fallo entre las dos escrituras dejaría un artículo
   * "publicado" que el catálogo sigue sin mostrar, porque `LIST_PUBLISHED_SQL` filtra
   * por `current_version_id`.
   *
   * La comprobación `approved_by ≠ created_by` se hace AQUÍ, contra la fila bloqueada,
   * antes del `UPDATE` — no solo se confía en el CHECK del esquema. Así un editor que
   * intenta publicar su propio artículo recibe `forbidden` (PERMISSION_DENIED) y no un
   * `INTERNAL` genérico por violación de constraint.
   */
  public async approveAndPublish(versionId: string, coordinatorId: string): Promise<PublishedVersion> {
    try {
      return await execTx(this.pool, async (client: PoolClient) => {
        const found = await client.query<RawRow>(FIND_VERSION_FOR_UPDATE_SQL, [versionId]);
        const current = found.rows[0];
        if (current === undefined) {
          throw notFound(`no existe la versión ${versionId}`);
        }
        if (current.state !== 'en_revision') {
          throw conflict(`la versión ${versionId} no está en revisión (estado actual: ${current.state})`);
        }
        if (current.created_by === coordinatorId) {
          throw forbidden('un editor no puede aprobar ni publicar su propio artículo (FR-008)');
        }

        const published = await client.query<RawRow>(PUBLISH_VERSION_SQL, [versionId, coordinatorId]);
        const row = mustRow(published.rows[0], 'publicar la versión');
        const article = await client.query<{ title: string; category: string }>(SET_CURRENT_VERSION_SQL, [
          row.article_id,
          row.id,
        ]);
        const articleRow = mustArticleRow(article.rows[0]);
        return { ...toVersion(row), title: articleRow.title, category: articleRow.category };
      });
    } catch (err) {
      if (err instanceof DomainError) {
        throw err;
      }
      throw storageError(`publicar la versión ${versionId}`, err);
    }
  }

  /** `publicado → archivado`. */
  public async archive(versionId: string): Promise<VersionRow> {
    try {
      const result = await this.pool.query<RawRow>(ARCHIVE_VERSION_SQL, [versionId]);
      const row = result.rows[0];
      if (row === undefined) {
        const existing = await this.pool.query<{ state: string }>('SELECT state FROM article_versions WHERE id = $1', [
          versionId,
        ]);
        if (existing.rows[0] === undefined) {
          throw notFound(`no existe la versión ${versionId}`);
        }
        throw conflict(`la versión ${versionId} no está publicada (estado actual: ${existing.rows[0].state})`);
      }
      return toVersion(row);
    } catch (err) {
      if (err instanceof DomainError) {
        throw err;
      }
      throw storageError(`archivar la versión ${versionId}`, err);
    }
  }

  /**
   * Historial de versiones (FR-013), bandeja de revisión (`state=en_revision`) y
   * borradores propios (`editorId`) — la misma consulta sirve a las tres vistas según
   * qué filtros llegan rellenos.
   */
  public async listVersions(filter: VersionFilter, page: Page): Promise<Paged<VersionRow>> {
    const articleId = filter.articleId === '' ? null : filter.articleId;
    const editorId = filter.editorId === '' ? null : filter.editorId;
    try {
      const [rows, count] = await Promise.all([
        this.pool.query<RawRow>(LIST_VERSIONS_SQL, [articleId, filter.state, editorId, page.limit, page.offset]),
        this.pool.query<{ total: string }>(COUNT_VERSIONS_SQL, [articleId, filter.state, editorId]),
      ]);
      return {
        items: rows.rows.map(toVersion),
        total: Number.parseInt(count.rows[0]?.total ?? '0', 10),
      };
    } catch (err) {
      throw storageError('listar versiones', err);
    }
  }
}

function mustRow(row: RawRow | undefined, operation: string): RawRow {
  if (row === undefined) {
    throw storageError(operation, new Error('la sentencia no devolvió fila'));
  }
  return row;
}

function mustArticleRow(row: { title: string; category: string } | undefined): { title: string; category: string } {
  if (row === undefined) {
    throw storageError('leer título/categoría tras publicar', new Error('el UPDATE no devolvió fila'));
  }
  return row;
}

/** Fila → versión (Principio IX regla 3). */
function toVersion(row: RawRow): VersionRow {
  return {
    versionId: row.id,
    articleId: row.article_id,
    versionNo: row.version_no,
    body: row.body,
    state: row.state,
    createdBy: row.created_by,
    approvedBy: row.approved_by ?? '',
    createdAt: row.created_at.toISOString(),
    publishedAt: row.published_at === null ? '' : row.published_at.toISOString(),
  };
}
