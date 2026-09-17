/**
 * Persistencia de las imágenes del cuerpo del artículo (T125, FR-064…FR-067).
 *
 * El **identificador es el SHA-256 del contenido**: subir dos veces la misma imagen no
 * duplica bytes, porque la segunda subida encuentra la fila. Esa es toda la idea del
 * direccionamiento por contenido, y tiene una consecuencia que conviene decir en voz alta:
 * el mismo archivo subido a dos artículos es **una sola fila**, y `article_id` guarda quién
 * lo subió primero. FR-067 —cada versión conserva las imágenes que tenía— se cumple por el
 * **documento**: la referencia vive en el nodo `imagen` de `body_doc`, no en esta tabla.
 *
 * `ON CONFLICT DO NOTHING` y después `SELECT`: no se usa `RETURNING` sobre un `INSERT` que
 * puede no insertar. Buscar primero y luego insertar sería una carrera —dos subidas
 * simultáneas del mismo archivo calculan el mismo hash y las dos intentan insertar—, así que
 * se intenta insertar y se acepta el conflicto, que es la única forma de que la deduplicación
 * sea correcta bajo concurrencia.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import { PG_POOL } from '../common/database.module';
import type { Count } from '../common/counts';
import { DomainError, notFound, storageError } from '../common/errors';
import { execTx } from '../common/tx';

/** Una imagen ya almacenada. Los bytes NO viajan aquí: pesan hasta 2 MB. */
export interface ImageRow {
  readonly imageId: string;
  readonly articleId: string;
  readonly mimeType: string;
  readonly byteSize: Count;
  readonly width: number;
  readonly height: number;
  readonly uploadedBy: string;
  readonly createdAt: string;
}

/** Fila cruda de `article_images`, sin los bytes. */
interface RawImageRow {
  readonly id: string;
  readonly article_id: string;
  readonly mime_type: string;
  readonly byte_size: number;
  readonly width: number;
  readonly height: number;
  readonly uploaded_by: string;
  readonly created_at: Date;
}

const IMAGE_COLUMNS = `id, article_id, mime_type, byte_size, width, height, uploaded_by, created_at`;

/**
 * `ON CONFLICT (id) DO NOTHING` es la deduplicación: si el hash ya está, no se toca la fila
 * existente —ni su `article_id`— y la lectura posterior devuelve la que había.
 */
const INSERT_IMAGE_SQL = `
INSERT INTO article_images (id, article_id, mime_type, byte_size, width, height, bytes, uploaded_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (id) DO NOTHING`;

const FIND_IMAGE_SQL = `SELECT ${IMAGE_COLUMNS} FROM article_images WHERE id = $1`;

/** Los bytes se piden aparte, y solo cuando alguien los va a servir. */
const FIND_IMAGE_BYTES_SQL = `SELECT bytes FROM article_images WHERE id = $1`;

/** ¿Existe el artículo al que se le va a colgar la imagen? */
const ARTICLE_EXISTS_SQL = `SELECT 1 FROM articles WHERE id = $1`;

@Injectable()
export class ImagesRepository {
  public constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Guarda una imagen y devuelve la fila resultante — la nueva o la que ya estaba con ese
   * mismo contenido. Lanza `not_found` si el artículo no existe: una imagen huérfana no
   * tiene dónde referenciarse y la clave foránea lo diría con un error de driver.
   */
  public async save(input: {
    readonly imageId: string;
    readonly articleId: string;
    readonly mimeType: string;
    readonly byteSize: number;
    readonly width: number;
    readonly height: number;
    readonly bytes: Buffer;
    readonly uploadedBy: string;
  }): Promise<{ readonly image: ImageRow; readonly deduplicated: boolean }> {
    try {
      return await execTx(this.pool, async (client: PoolClient) => {
        const exists = await client.query(ARTICLE_EXISTS_SQL, [input.articleId]);
        if (exists.rows[0] === undefined) {
          throw notFound(`no existe el artículo ${input.articleId}`);
        }

        const inserted = await client.query(INSERT_IMAGE_SQL, [
          input.imageId,
          input.articleId,
          input.mimeType,
          input.byteSize,
          input.width,
          input.height,
          input.bytes,
          input.uploadedBy,
        ]);

        const found = await client.query<RawImageRow>(FIND_IMAGE_SQL, [input.imageId]);
        const row = found.rows[0];
        if (row === undefined) {
          throw storageError('guardar la imagen', new Error('el INSERT no dejó fila legible'));
        }
        // `rowCount` dice si esta llamada fue la que insertó: es la diferencia entre «la
        // subí» y «ya estaba», y el cliente merece saber cuál de las dos pasó.
        return { image: toImage(row), deduplicated: inserted.rowCount === 0 };
      });
    } catch (err) {
      // Los errores de dominio cruzan tal cual: envolver un `not_found` en un `storage`
      // convertiría «el artículo no existe» en «falló el almacenamiento», que manda a
      // quien depura a mirar la base cuando el problema es el identificador que envió.
      if (err instanceof DomainError) {
        throw err;
      }
      throw storageError(`guardar la imagen ${input.imageId}`, err);
    }
  }

  /** Metadatos de una imagen, o `null` si no existe. */
  public async find(imageId: string): Promise<ImageRow | null> {
    try {
      const result = await this.pool.query<RawImageRow>(FIND_IMAGE_SQL, [imageId]);
      const row = result.rows[0];
      return row === undefined ? null : toImage(row);
    } catch (err) {
      throw storageError(`leer la imagen ${imageId}`, err);
    }
  }

  /** Bytes de una imagen, o `null` si no existe. */
  public async findBytes(imageId: string): Promise<Buffer | null> {
    try {
      const result = await this.pool.query<{ bytes: Buffer }>(FIND_IMAGE_BYTES_SQL, [imageId]);
      return result.rows[0]?.bytes ?? null;
    } catch (err) {
      throw storageError(`leer los bytes de la imagen ${imageId}`, err);
    }
  }
}

function toImage(row: RawImageRow): ImageRow {
  return {
    imageId: row.id,
    articleId: row.article_id,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at.toISOString(),
  };
}
