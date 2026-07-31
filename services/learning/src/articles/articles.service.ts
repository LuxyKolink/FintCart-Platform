/**
 * Capa de aplicación del catálogo (Principio IX).
 *
 * Entre el transporte y el repositorio hay poco que decidir, y lo poco que hay está
 * aquí: validar el identificador antes de que llegue al SQL, resolver la paginación y
 * convertir «no hay fila» en un error de dominio.
 *
 * Lo que NO hace: no conoce protobuf, no formatea respuestas y no sabe qué es un
 * `PageResponse`. Esa traducción vive en `grpc/mapping.ts`.
 */
import { Injectable } from '@nestjs/common';

import type { Count } from '../common/counts';
import { invalidArgument, notFound } from '../common/errors';
import { nextPageToken, resolvePage, type PageRequestLike } from '../common/pagination';

import type { ArticleDetail, ArticleSummary } from './articles.repository';
import { ArticlesRepository } from './articles.repository';

/** Página del catálogo lista para el contrato. */
export interface CatalogPage {
  readonly items: readonly ArticleSummary[];
  readonly nextPageToken: string;
  readonly totalSize: Count;
}

/** Un UUID canónico en cualquiera de sus versiones. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ArticlesService {
  public constructor(private readonly repository: ArticlesRepository) {}

  /**
   * Catálogo publicado (FR-010, SC-009).
   *
   * La categoría vacía significa «todas» y no es un error: el catálogo completo es la
   * vista por defecto de la SPA, y exigir una categoría obligaría al cliente a conocer
   * la lista antes de poder pedir nada.
   */
  public async listPublished(
    category: string,
    page: PageRequestLike | undefined,
  ): Promise<CatalogPage> {
    const window = resolvePage(page);
    const result = await this.repository.listPublished(category.trim(), window);

    return {
      items: result.items,
      nextPageToken: nextPageToken(window, result.items.length, result.total),
      totalSize: result.total,
    };
  }

  /**
   * Artículo publicado por su identificador (FR-011). Registra la vista (D-06).
   *
   * @throws {DomainError} `invalid_argument` si el id no es un UUID, `not_found` si no
   *   hay artículo publicado con ese id.
   */
  public async getArticle(articleId: string): Promise<ArticleDetail> {
    // Se valida ANTES de consultar. Sin esto, un `article_id` con forma de texto libre
    // llegaría al SQL y PostgreSQL respondería `invalid input syntax for type uuid`,
    // que la capa de transporte traduciría a un 500 — un error del servidor por un
    // dato del cliente.
    if (!UUID.test(articleId)) {
      throw invalidArgument(`article_id no es un UUID: ${JSON.stringify(articleId)}`);
    }

    const article = await this.repository.findPublishedAndRecordView(articleId);
    if (article === null) {
      throw notFound(`no hay artículo publicado con id ${articleId}`);
    }
    return article;
  }
}
