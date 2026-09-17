/**
 * Servicio de imágenes del cuerpo del artículo (T126, FR-064…FR-067).
 *
 * La decisión que da forma a todo este archivo: **el tipo y el tamaño se comprueban contra
 * los BYTES, no contra lo que declara el cliente** (FR-066). Un `Content-Type` y un nombre
 * de archivo los elige quien sube, así que creerlos es no comprobar nada; `sharp` abre el
 * contenido y dice qué es de verdad, y si no puede abrirlo, no es una imagen. Se rechaza un
 * archivo que diga `image/png` y sea un ZIP, y se rechaza un PDF renombrado.
 *
 * El tope de 2 MB (research D-13) se comprueba **antes** de intentar decodificar: la
 * comprobación más barata va primero, para no gastar memoria en algo que se va a rechazar.
 *
 * El identificador es el SHA-256 del contenido, así que se calcula aquí y no se acepta del
 * cliente: si lo mandara él, podría subir una imagen con el identificador de otra y
 * envenenar la deduplicación.
 *
 * Lo que NO hace: no sirve los bytes (eso es el controlador), no decide quién puede subir
 * —el rol lo verifica el Gateway antes de enrutar, FR-081— y no toca el documento del
 * artículo. La validación de que las imágenes referenciadas existen es de `T128`, y vive en
 * el camino de guardado del artículo, que es donde se conoce el documento.
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

import { invalidArgument, notFound } from '../common/errors';

import { ImagesRepository, type ImageRow } from './images.repository';

/**
 * Tipos admitidos. Es la misma lista que el `CHECK` de la tabla: aquí da un mensaje
 * legible y allí impide que una escritura por otro camino meta algo distinto.
 */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Tope de 2 MB (research D-13). El mismo número que el `CHECK` de `article_images`. */
export const MAX_IMAGE_BYTES = 2_097_152;

/** Lo que devuelve `sharp` sobre los bytes reales. */
interface Decoded {
  readonly format: string | undefined;
  readonly width: number | undefined;
  readonly height: number | undefined;
}

export interface StoredImage {
  readonly image: ImageRow;
  /** `true` si el contenido ya estaba: la subida no escribió bytes nuevos. */
  readonly deduplicated: boolean;
}

/**
 * Formato que `sharp` reporta → tipo MIME del contrato.
 *
 * `sharp` habla de `jpeg`, `png` y `webp`; el contrato de tipos MIME. La traducción existe
 * porque son dos vocabularios distintos y unirlos con una comparación de cadenas sería
 * confiar en que nunca difieran.
 */
const FORMAT_TO_MIME: Readonly<Record<string, AllowedMimeType>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

@Injectable()
export class ImagesService {
  public constructor(private readonly repository: ImagesRepository) {}

  /**
   * Guarda una imagen del cuerpo de un artículo.
   *
   * @throws {DomainError} `invalid_argument` si los bytes no son una imagen admitida o
   * pasan del tope; `not_found` si el artículo no existe.
   */
  public async upload(input: {
    readonly articleId: string;
    readonly declaredMimeType: string;
    readonly bytes: Buffer;
    readonly uploadedBy: string;
  }): Promise<StoredImage> {
    requireUuid('article_id', input.articleId);
    requireUuid('uploaded_by', input.uploadedBy);

    if (input.bytes.length === 0) {
      throw invalidArgument('la imagen está vacía');
    }
    if (input.bytes.length > MAX_IMAGE_BYTES) {
      // El mensaje lleva los dos números en MB y en bytes: quien sube una foto de 4 MB
      // quiere saber cuánto pasó y cuál es el tope, no «archivo demasiado grande».
      throw invalidArgument(
        `la imagen ocupa ${describeBytes(input.bytes.length)} y el tope es ` +
          `${describeBytes(MAX_IMAGE_BYTES)} (${MAX_IMAGE_BYTES} bytes)`,
      );
    }

    const { mimeType, width, height } = await inspect(input.bytes, input.declaredMimeType);
    const imageId = createHash('sha256').update(input.bytes).digest('hex');

    const { image, deduplicated } = await this.repository.save({
      imageId,
      articleId: input.articleId,
      mimeType,
      byteSize: input.bytes.length,
      width,
      height,
      bytes: input.bytes,
      uploadedBy: input.uploadedBy,
    });

    return { image, deduplicated };
  }

  /** Metadatos de una imagen. */
  /**
   * De esta lista, qué imágenes NO existen (T128).
   *
   * Vive aquí y no en quien valida el documento porque la tabla es de este módulo: un
   * validador de bloques que consultara `article_images` sabría de imágenes, y el
   * vocabulario del documento dejaría de ser solo un vocabulario.
   */
  public async findMissing(imageIds: readonly string[]): Promise<readonly string[]> {
    const existentes = await this.repository.findExisting(imageIds);
    const hay = new Set(existentes);
    return imageIds.filter((id) => !hay.has(id));
  }

  public async getMetadata(imageId: string): Promise<ImageRow> {
    requireHex('image_id', imageId);
    const image = await this.repository.find(imageId);
    if (image === null) {
      throw notFound(`no existe la imagen ${imageId}`);
    }
    return image;
  }

  /** Metadatos y bytes, que es lo que necesita quien sirve la imagen. */
  public async getWithBytes(imageId: string): Promise<{ image: ImageRow; bytes: Buffer }> {
    requireHex('image_id', imageId);
    const [image, bytes] = await Promise.all([
      this.repository.find(imageId),
      this.repository.findBytes(imageId),
    ]);
    if (image === null || bytes === null) {
      throw notFound(`no existe la imagen ${imageId}`);
    }
    return { image, bytes };
  }
}

/**
 * Abre los bytes y devuelve lo que son de verdad.
 *
 * `sharp(bytes).metadata()` NO lanza ante un archivo que no sea imagen: devuelve un objeto
 * sin `width`/`height` y con `format: undefined`. Eso obliga a comprobarlos explícitamente —
 * un `try/catch` a secas dejaría pasar un archivo cualquiera por la rama «no lanzó».
 */
async function inspect(
  bytes: Buffer,
  declaredMimeType: string,
): Promise<{ mimeType: AllowedMimeType; width: number; height: number }> {
  let decoded: Decoded;
  try {
    decoded = await sharp(bytes).metadata();
  } catch (err) {
    // Aquí entra lo que ni siquiera se puede abrir: bytes truncados, un PDF, un ZIP.
    throw invalidArgument(
      `los bytes no son una imagen legible (tipo declarado: ${declaredMimeType || 'ninguno'})`,
      err,
    );
  }

  const mimeType = decoded.format === undefined ? undefined : FORMAT_TO_MIME[decoded.format];
  if (mimeType === undefined) {
    throw invalidArgument(
      `el formato real del archivo no está admitido (${decoded.format ?? 'desconocido'}); ` +
        `se admiten: ${ALLOWED_MIME_TYPES.join(', ')}`,
    );
  }
  if (decoded.width === undefined || decoded.height === undefined) {
    throw invalidArgument('no se pudieron leer las dimensiones de la imagen');
  }

  // Que el tipo declarado no coincida con el real NO se corrige en silencio: se dice. No
  // se rechaza —el archivo es una imagen válida y admitida—, pero quien sube un PNG
  // llamándolo JPEG tiene un error en su cliente y merece saberlo.
  if (declaredMimeType !== '' && declaredMimeType !== mimeType) {
    throw invalidArgument(
      `el archivo dice ser ${declaredMimeType} y es ${mimeType}; el tipo declarado no es de ` +
        'fiar y el que vale es el real',
    );
  }

  return { mimeType, width: decoded.width, height: decoded.height };
}

/** Describe un tamaño en MB y en bytes, para que el mensaje sea útil de leer. */
function describeBytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** SHA-256 en hexadecimal: la forma del identificador, impuesta también por la tabla. */
const SHA256 = /^[0-9a-f]{64}$/;

function requireUuid(field: string, value: string): void {
  if (!UUID.test(value)) {
    throw invalidArgument(`${field} no es un UUID: ${JSON.stringify(value)}`);
  }
}

function requireHex(field: string, value: string): void {
  if (!SHA256.test(value)) {
    throw invalidArgument(
      `${field} no es un SHA-256 en hexadecimal: ${JSON.stringify(value)}`,
    );
  }
}
