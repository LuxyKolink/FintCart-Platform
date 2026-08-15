/**
 * Versionado incremental de artículos (FR-013, T161).
 *
 * Aislado de `publishing.service.ts` porque es la única decisión de este flujo que NO
 * depende de quién llama ni de en qué estado está el borrador que se está creando: dado
 * un artículo, calcula y persiste la SIGUIENTE versión. `publishing.service.ts` decide
 * CUÁNDO llamarlo (borrador nuevo con `article_id` relleno); este archivo no conoce el
 * contrato de entrada, solo `article_id`, `editor_id` y el cuerpo.
 */
import { Injectable } from '@nestjs/common';

import { PublishingRepository, type VersionRow } from './publishing.repository';

@Injectable()
export class VersioningService {
  public constructor(private readonly repository: PublishingRepository) {}

  /**
   * Nueva versión en `borrador` de un artículo existente, preservando la trazabilidad
   * histórica: la fila anterior (publicada o archivada) no se toca, y `version_no` es
   * estrictamente incremental (`UNIQUE (article_id, version_no)`, impuesto por el
   * esquema).
   *
   * @throws {DomainError} `not_found` si `articleId` no existe.
   */
  public async newVersionOf(articleId: string, editorId: string, body: string): Promise<VersionRow> {
    return this.repository.createNewVersion(articleId, editorId, body);
  }
}
