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

import { extractBodyDocReferences, validateBodyDoc } from '../articles/body-doc.validator';
import type { BodyDocNode } from '../articles/body-doc';
import {
  PublishedCalculators,
  unpublishedCalculatorsError,
} from '../articles/published-calculators';
import { bodyDocToPlainText, plainTextToBodyDoc } from '../articles/plain-text';
import { CategoriesService } from '../categories/categories.service';
import { EventsPublisher } from '../events/publisher';
import { ImagesService } from '../images/images.service';
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
    private readonly categories: CategoriesService,
    private readonly images: ImagesService,
    private readonly calculators: PublishedCalculators,
  ) {}

  /**
   * Crea un borrador (FR-007). `articleId` vacío ⇒ artículo nuevo; no vacío ⇒ nueva
   * versión de uno existente (FR-013, delegado a `VersioningService`).
   *
   * `categoryId` es obligatorio y debe existir y estar ACTIVA solo al crear un artículo
   * NUEVO (FR-034): la categoría vive en `articles` y la comparten todas las versiones,
   * así que una nueva versión de un artículo ya existente la deja intacta.
   */
  public async createDraft(
    title: string,
    categoryId: string,
    body: string,
    editorId: string,
    articleId: string,
    bodyDoc: unknown = null,
  ): Promise<VersionRow> {
    requireUuid('editor_id', editorId);
    const resuelto = await this.resolveBody(body, bodyDoc);
    if (resuelto.doc.contenido === undefined || resuelto.doc.contenido.length === 0) {
      throw invalidArgument(
        'el cuerpo no puede estar vacío: una versión sin ningún bloque no tiene nada que publicar',
      );
    }

    if (articleId !== '') {
      requireUuid('article_id', articleId);
      return this.versioning.newVersionOf(articleId, editorId, resuelto.body, resuelto.doc);
    }

    if (title.trim() === '') {
      throw invalidArgument('title no puede estar vacío');
    }
    await this.categories.assertActiveCategory(categoryId);
    return this.repository.createArticle(title, categoryId, resuelto.body, resuelto.doc, editorId);
  }

  /** Edita el cuerpo de un borrador propio (FR-007). */
  public async updateDraft(
    versionId: string,
    editorId: string,
    body: string,
    bodyDoc: unknown = null,
  ): Promise<VersionRow> {
    requireUuid('version_id', versionId);
    requireUuid('editor_id', editorId);
    const resuelto = await this.resolveBody(body, bodyDoc);
    if (resuelto.doc.contenido === undefined || resuelto.doc.contenido.length === 0) {
      throw invalidArgument(
        'el cuerpo no puede estar vacío: una versión sin ningún bloque no tiene nada que publicar',
      );
    }
    return this.repository.updateDraftBody(versionId, editorId, resuelto.body, resuelto.doc);
  }

  /**
   * Resuelve el par (texto, documento) que se persiste cuando llega un cuerpo (T131).
   *
   * **El documento es la fuente de verdad cuando llega**: el texto se DERIVA de él con
   * `bodyDocToPlainText`. Guardar los dos tal como vengan —el texto por un lado, el
   * documento por otro— dejaría dos versiones del mismo cuerpo que pueden contradecirse,
   * y a partir de ahí cada lector tendría que decidir cuál gana. El texto sigue
   * guardándose porque `article_versions.body` es `NOT NULL` y porque el lector de 001
   * solo entiende texto.
   *
   * Cuando NO llega documento, el cuerpo es heredado —un cliente anterior al editor, o
   * una prueba— y se convierte con la MISMA regla que usó la migración `20260902111500`:
   * un párrafo por bloque separado por una línea en blanco.
   *
   * El orden de las comprobaciones no es casual: primero la forma del documento (no toca
   * la base), después que no esté vacío, y solo al final las referencias, que sí son una
   * consulta. Un documento malformado no debe costar una ida a la base.
   */
  private async resolveBody(body: string, bodyDoc: unknown): Promise<{ body: string; doc: BodyDocNode }> {
    if (bodyDoc === null || bodyDoc === undefined) {
      return { body, doc: plainTextToBodyDoc(body) };
    }

    const doc = validateBodyDoc(bodyDoc);
    const referencias = extractBodyDocReferences(doc);
    const faltantes = await this.images.findMissing(referencias.imageIds);
    if (faltantes.length > 0) {
      throw invalidArgument(
        `el documento referencia ${faltantes.length === 1 ? 'una imagen que no existe' : 'imágenes que no existen'}: ` +
          `${faltantes.join(', ')}. Una referencia rota se guardaría sin error y el lector mostraría un hueco roto; ` +
          'vuelve a insertar la imagen desde el editor',
      );
    }

    // La calculadora incrustada se comprueba contra el Simulador, por gRPC (T151, D-25). Es una
    // pregunta distinta de la de las imágenes —aquella se contesta en esta misma base, esta en
    // otro servicio— y por eso va después: si el documento tiene las dos cosas mal, el autor ve
    // primero lo que puede arreglar sin salir de la pantalla.
    //
    // Se pregunta solo si hay alguna: un artículo sin calculadoras no debe costar una llamada de
    // red al Simulador, y ese es el caso de la inmensa mayoría de los guardados.
    if (referencias.calculatorIds.length > 0) {
      const sinPublicar = await this.calculators.missing(referencias.calculatorIds);
      if (sinPublicar.length > 0) {
        throw invalidArgument(unpublishedCalculatorsError(sinPublicar));
      }
    }

    return { body: bodyDocToPlainText(doc), doc };
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
