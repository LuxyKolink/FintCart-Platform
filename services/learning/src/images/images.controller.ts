/**
 * Capa de TRANSPORTE de las imágenes del artículo (T127, FR-064…FR-067, D-13).
 *
 * Espejo de los demás controladores: recibe el mensaje, llama al servicio, convierte y
 * traduce el error con `codeOf`/`clientMessage`. No decide políticas y no conoce el rol del
 * llamador: el Gateway lo verifica antes de enrutar (FR-081).
 *
 * `GetArticleImage` devuelve los BYTES junto a los metadatos porque quien los pide los va a
 * servir o a dibujar; separarlos obligaría a dos llamadas para una sola cosa. Aprendizaje no
 * construye direcciones ni conoce el Gateway: es el borde el que decide cómo se sirven
 * (T130, con `ETag` y caché inmutable, que es correcto porque el identificador ES el hash).
 */
import { Controller } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';

import { messageOf } from '../common/errors';
import { JsonLogger } from '../common/observability';
import { codeOf, clientMessage } from '../common/rpc-errors';
import type {
  ArticleImage as ArticleImagePb,
  ArticleImageRef,
  GetArticleImageResponse,
  UploadArticleImageRequest,
} from '../pb/fintcart/learning/v1/learning';

import { imageToPb } from './mapping';
import { ImagesService } from './images.service';

const SERVICE = 'LearningService';

@Controller()
export class ImagesController {
  private readonly logger = new JsonLogger();

  public constructor(private readonly images: ImagesService) {}

  @GrpcMethod(SERVICE, 'UploadArticleImage')
  public async uploadArticleImage(request: UploadArticleImageRequest): Promise<ArticleImagePb> {
    return this.guard('UploadArticleImage', async () => {
      const { image } = await this.images.upload({
        articleId: request.article_id ?? '',
        declaredMimeType: request.mime_type ?? '',
        // `bytes` llega como `Uint8Array` con ts-proto; `Buffer.from` lo envuelve SIN
        // copiar (comparte el mismo ArrayBuffer), así que no hay un segundo buffer de 2 MB
        // por subida.
        bytes: Buffer.from(request.bytes ?? new Uint8Array()),
        uploadedBy: request.uploaded_by ?? '',
      });
      return imageToPb(image);
    });
  }

  @GrpcMethod(SERVICE, 'GetArticleImage')
  public async getArticleImage(request: ArticleImageRef): Promise<GetArticleImageResponse> {
    return this.guard('GetArticleImage', async () => {
      const { image, bytes } = await this.images.getWithBytes(request.image_id ?? '');
      return { image: imageToPb(image), bytes };
    });
  }

  private async guard<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      this.logger.error(`${operation} falló: ${messageOf(err)}`, operation);
      throw new RpcException({ code: codeOf(err), message: clientMessage(err) });
    }
  }
}
