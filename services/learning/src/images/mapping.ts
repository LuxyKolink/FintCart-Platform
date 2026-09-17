/**
 * Mapeo de imagen de dominio → contrato (Principio IX, T127).
 *
 * `byte_size` viaja como STRING aunque hoy quepa de sobra en un `number`: es un conteo que
 * el contrato declara `string` para no tener que cambiarlo el día que un número grande no
 * quepa en un entero seguro de JavaScript. La conversión se hace aquí y solo aquí.
 */
import type { ArticleImage as ArticleImagePb } from '../pb/fintcart/learning/v1/learning';

import type { ImageRow } from './images.repository';

export function imageToPb(image: ImageRow): ArticleImagePb {
  return {
    image_id: image.imageId,
    article_id: image.articleId,
    mime_type: image.mimeType,
    byte_size: String(image.byteSize),
    width: image.width,
    height: image.height,
  };
}
