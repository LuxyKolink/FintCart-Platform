/**
 * Capa de aplicación del flujo editorial (Principio IX, FR-007/FR-008/FR-013).
 *
 * Valida identificadores antes de tocar el SQL — el mismo motivo que ya documentan
 * `articles.service.ts` y `quizzes.service.ts`: un id con forma de texto libre haría
 * que PostgreSQL respondiera `invalid input syntax for type uuid`, y la capa de
 * transporte lo traduciría a un error interno por un dato del cliente.
 *
 * Lo que NO hace: no decide `approved_by ≠ created_by` (vive en el repositorio, contra
 * la fila bloqueada — ver `publishing.repository.ts::approveAndPublish`) ni conoce
 * protobuf (`grpc/mapping.ts`).
 */
import { Injectable } from '@nestjs/common';

import type { Count } from '../common/counts';
import { invalidArgument } from '../common/errors';
import { nextPageToken, resolvePage, type PageRequestLike } from '../common/pagination';

import { EventsPublisher } from '../events/publisher';
import { PublishingRepository, type VersionFilter, type VersionRow } from './publishing.repository';
import { VersioningService } from './versioning.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Página de versiones lista para el contrato (espejo de `CatalogPage`). */
export interface VersionsPage {
  readonly items: readonly VersionRow[];
  readonly nextPageToken: string;
  readonly totalSize: Count;
}

function requireUuid(field: string, value: string): void {
  if (!UUID.test(value)) {
    throw invalidArgument(`${field} no es un UUID: ${JSON.stringify(value)}`);
  }
}

@Injectable()
export class PublishingService {
  public constructor(
    private readonly repository: PublishingRepository,
    private readonly versioning: VersioningService,
    private readonly events: EventsPublisher,
  ) {}

  /**
   * Crea un borrador (FR-007). `articleId` vacío ⇒ artículo nuevo; no vacío ⇒ nueva
   * versión de uno existente (FR-013, delegado a `VersioningService`).
   */
  public async createDraft(
    title: string,
    category: string,
    body: string,
    editorId: string,
    articleId: string,
  ): Promise<VersionRow> {
    requireUuid('editor_id', editorId);
    if (body.trim() === '') {
      throw invalidArgument('body no puede estar vacío');
    }

    if (articleId !== '') {
      requireUuid('article_id', articleId);
      return this.versioning.newVersionOf(articleId, editorId, body);
    }

    if (title.trim() === '') {
      throw invalidArgument('title no puede estar vacío');
    }
    if (category.trim() === '') {
      throw invalidArgument('category no puede estar vacía');
    }
    return this.repository.createArticle(title, category, body, editorId);
  }

  /** Edita el cuerpo de un borrador propio (FR-007). */
  public async updateDraft(versionId: string, editorId: string, body: string): Promise<VersionRow> {
    requireUuid('version_id', versionId);
    requireUuid('editor_id', editorId);
    if (body.trim() === '') {
      throw invalidArgument('body no puede estar vacío');
    }
    return this.repository.updateDraftBody(versionId, editorId, body);
  }

  /** `borrador → en_revision` (FR-008). */
  public async submitForReview(versionId: string, editorId: string): Promise<VersionRow> {
    requireUuid('version_id', versionId);
    requireUuid('actor_id', editorId);
    return this.repository.submitForReview(versionId, editorId);
  }

  /**
   * `en_revision → publicado` (FR-008) y publica `learning.article_published` (T163).
   *
   * La publicación del evento va DESPUÉS de que la transacción de
   * `approveAndPublish` ya confirmó: un evento es una notificación de algo que YA
   * ocurrió, y publicarlo antes de confirmar arriesgaría anunciar una publicación que
   * el `COMMIT` todavía podría no llegar a hacer.
   */
  public async approveAndPublish(versionId: string, coordinatorId: string): Promise<VersionRow> {
    requireUuid('version_id', versionId);
    requireUuid('coordinator_id', coordinatorId);

    const published = await this.repository.approveAndPublish(versionId, coordinatorId);
    await this.events.publishArticlePublished(coordinatorId, {
      article_id: published.articleId,
      version_no: published.versionNo,
      title: published.title,
      category: published.category,
      approved_by: published.approvedBy,
      created_by: published.createdBy,
    });
    return published;
  }

  /** `publicado → archivado`. */
  public async archive(versionId: string): Promise<VersionRow> {
    requireUuid('version_id', versionId);
    return this.repository.archive(versionId);
  }

  /**
   * Historial de un artículo, bandeja de revisión del coordinador o borradores propios
   * de un editor (FR-013) — según qué filtros de `filter` lleguen rellenos.
   */
  public async listVersions(filter: VersionFilter, page: PageRequestLike | undefined): Promise<VersionsPage> {
    if (filter.articleId !== '') {
      requireUuid('article_id', filter.articleId);
    }
    if (filter.editorId !== '') {
      requireUuid('editor_id', filter.editorId);
    }
    const window = resolvePage(page);
    const result = await this.repository.listVersions(filter, window);
    return {
      items: result.items,
      nextPageToken: nextPageToken(window, result.items.length, result.total),
      totalSize: result.total,
    };
  }
}
