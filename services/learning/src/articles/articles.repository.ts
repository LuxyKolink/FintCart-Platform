/**
 * Persistencia de artículos y versiones (Principio IX: capa `storer`).
 *
 * Esta capa habla SQL y tipos de fila, nada más. No decide qué es un catálogo, no
 * valida y no conoce protobuf: los tipos generados no llegan aquí (Principio IX
 * regla 1), y por eso los métodos reciben y devuelven tipos declarados en este
 * archivo.
 *
 * Una regla que se aplica en todas las consultas de lectura pública: el catálogo solo
 * expone versiones en estado `publicado`. Se filtra en el SQL y no en la capa de
 * aplicación porque un borrador filtrado por error no es un fallo cosmético — es
 * contenido sin revisar publicado bajo la marca (FR-008).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { PG_POOL } from '../common/database.module';
import type { Count } from '../common/counts';
import { storageError } from '../common/errors';
import type { BodyDocNode } from './body-doc';
import type { Page } from '../common/pagination';
import { execTx } from '../common/tx';

/** Entrada del catálogo: lo que se ve en un listado, sin el cuerpo. */
export interface ArticleSummary {
  readonly articleId: string;
  readonly title: string;
  /** Nombre visible de la categoría, resuelto por JOIN con `categories` (FR-034). */
  readonly category: string;
  /** Referencia al catálogo: `categories.id`. */
  readonly categoryId: string;
  readonly currentVersionNo: Count;
}

/** Artículo completo, con el cuerpo de su versión publicada vigente. */
export interface ArticleDetail extends ArticleSummary {
  /**
   * Documento de bloques de la versión publicada (FR-063). **No anulable**: desde T135 es
   * la única representación del cuerpo que existe en la base — `article_versions.body`
   * dejó de existir (D-14)—, así que no hay caída al texto plano ni caso heredado que
   * atender. Lo que queda por decidir cuando se lee es qué se HACE con el documento, y eso
   * es del lector.
   */
  readonly bodyDoc: BodyDocNode;
  readonly quizIds: readonly string[];
}

/** Página de resultados con el total, que el contrato expone como `total_size`. */
export interface Paged<T> {
  readonly items: readonly T[];
  readonly total: Count;
}

/** Fila cruda del catálogo. */
interface CatalogRow {
  readonly article_id: string;
  readonly title: string;
  readonly category: string;
  readonly category_id: string;
  readonly version_no: Count;
  readonly body_doc: BodyDocNode;
}

/**
 * El filtro de categoría se hace por `category_id` (`$1`, nulo = todas) y, en paralelo,
 * por el NOMBRE visible (`$2`, cadena vacía = todas) para los clientes que todavía usan
 * el filtro heredado de 001. Los dos filtros se conservan por separado — como hace
 * `publishing.repository.ts::LIST_VERSIONS_SQL`, los identificadores viajan como `null`
 * porque una cadena vacía no es un UUID válido para el cast `::uuid`.
 */
const LIST_PUBLISHED_SQL = `
SELECT a.id AS article_id, a.title, c.name AS category, a.category_id, v.version_no, v.body_doc
  FROM articles a
  JOIN article_versions v ON v.id = a.current_version_id
  JOIN categories c ON c.id = a.category_id
 WHERE v.state = 'publicado'
   AND ($1::uuid IS NULL OR a.category_id = $1::uuid)
   AND ($2 = '' OR c.name = $2)
 ORDER BY a.created_at DESC, a.id
 LIMIT $3 OFFSET $4`;

const COUNT_PUBLISHED_SQL = `
SELECT count(*) AS total
  FROM articles a
  JOIN article_versions v ON v.id = a.current_version_id
  JOIN categories c ON c.id = a.category_id
 WHERE v.state = 'publicado'
   AND ($1::uuid IS NULL OR a.category_id = $1::uuid)
   AND ($2 = '' OR c.name = $2)`;

const FIND_PUBLISHED_SQL = `
SELECT a.id AS article_id, a.title, c.name AS category, a.category_id, v.version_no, v.body_doc
  FROM articles a
  JOIN article_versions v ON v.id = a.current_version_id
  JOIN categories c ON c.id = a.category_id
 WHERE a.id = $1
   AND v.state = 'publicado'`;

const QUIZ_IDS_SQL = `
SELECT id FROM quizzes WHERE article_id = $1 ORDER BY created_at, id`;

/**
 * Incrementa la vista creando la fila de estadísticas si no existía.
 *
 * `ON CONFLICT DO UPDATE` y no un `SELECT` previo seguido de `INSERT` o `UPDATE`:
 * dos lecturas concurrentes del mismo artículo recién publicado insertarían las dos y
 * una fallaría por clave primaria. El upsert lo resuelve el motor en una sentencia.
 */
const RECORD_VIEW_SQL = `
INSERT INTO article_stats (article_id, view_count)
VALUES ($1, 1)
ON CONFLICT (article_id) DO UPDATE
   SET view_count = article_stats.view_count + 1`;

/** Repositorio de artículos. */
@Injectable()
export class ArticlesRepository {
  public constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Catálogo publicado, filtrable por `categoryId` (FR-034) o por nombre (heredado). */
  public async listPublished(categoryId: string, category: string, page: Page): Promise<Paged<ArticleSummary>> {
    try {
      const idFilter = categoryId === '' ? null : categoryId;
      // Las dos consultas van sin transacción a propósito: una discrepancia entre el
      // total y la página es intrascendente en un catálogo, y una transacción por
      // listado gastaría una conexión del pool en cada petición de lectura.
      const [rows, count] = await Promise.all([
        this.pool.query<CatalogRow>(LIST_PUBLISHED_SQL, [idFilter, category, page.limit, page.offset]),
        this.pool.query<{ total: string }>(COUNT_PUBLISHED_SQL, [idFilter, category]),
      ]);

      return {
        items: rows.rows.map(toSummary),
        // `count(*)` es `bigint` y `pg` lo entrega como STRING para no perder
        // precisión por encima de 2^53. Convertirlo aquí y no dejarlo pasar evita que
        // el total llegue al contrato como `"42"` en lugar de 42.
        total: Number.parseInt(count.rows[0]?.total ?? '0', 10),
      };
    } catch (err) {
      throw storageError('listar el catálogo publicado', err);
    }
  }

  /**
   * Artículo publicado con su cuerpo, registrando la vista (D-06, FR-018).
   *
   * La lectura y el incremento van en la MISMA transacción. Separarlos permitiría
   * contar una vista de un artículo que en ese instante dejó de estar publicado, y la
   * estadística dejaría de cuadrar con lo que el usuario pudo ver.
   *
   * Devuelve `null` si el artículo no existe o no tiene versión publicada: los dos
   * casos son indistinguibles PARA EL LECTOR, y distinguirlos en la respuesta
   * revelaría la existencia de borradores.
   */
  public async findPublishedAndRecordView(articleId: string): Promise<ArticleDetail | null> {
    return execTx(this.pool, async (client: PoolClient) => {
      try {
        const found = await client.query<CatalogRow>(FIND_PUBLISHED_SQL, [articleId]);
        const row = found.rows[0];
        if (row === undefined) {
          return null;
        }

        await client.query(RECORD_VIEW_SQL, [articleId]);
        const quizzes = await client.query<{ id: string }>(QUIZ_IDS_SQL, [articleId]);

        return {
          ...toSummary(row),
          bodyDoc: row.body_doc,
          quizIds: quizzes.rows.map((q) => q.id),
        };
      } catch (err) {
        throw storageError(`leer el artículo ${articleId}`, err);
      }
    });
  }
}

/** Fila → resumen de catálogo (Principio IX regla 3: mapeo explícito). */
function toSummary(row: CatalogRow): ArticleSummary {
  return {
    articleId: row.article_id,
    title: row.title,
    category: row.category,
    categoryId: row.category_id,
    currentVersionNo: row.version_no,
  };
}
