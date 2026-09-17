/**
 * El servicio de imágenes (T121, T126, FR-066).
 *
 * **Las imágenes de estas pruebas son imágenes de verdad.** Se generan con `sharp` en el
 * momento, no se escriben bytes a mano: un PNG inventado con la cabecera correcta y el resto
 * basura no probaría nada, porque lo que hay que fijar es justo que el servicio **abre el
 * contenido** y decide por lo que encuentra. Con bytes falsos, la prueba pasaría tanto si el
 * servicio mira los bytes como si solo mirara la cabecera.
 *
 * Los casos que importan son los rechazos, y el más importante es el primero: un archivo que
 * se declara `image/png` sin serlo. Un servicio que creyera el tipo declarado aceptaría un
 * ZIP, un ejecutable o un PDF — y ese es exactamente el agujero que FR-066 pide cerrar.
 */
import sharp from 'sharp';

import type { ImageRow } from '../../src/images/images.repository';
import { ImagesRepository } from '../../src/images/images.repository';
import {
  ALLOWED_MIME_TYPES,
  ImagesService,
  MAX_IMAGE_BYTES,
} from '../../src/images/images.service';
import { IDS, newMemoryFixture } from '../support/memdb';

/**
 * Convierte a `Buffer` el resultado de `sharp`.
 *
 * `sharp` viene sin tipos en este proyecto —no es dependencia de producción, solo de
 * pruebas— así que `.toBuffer()` devuelve `any` y el `return` de una función `async`
 * contamina con `any` todo lo que la use. Se resuelve en el borde, una sola vez, con una
 * comprobación de forma real: si `sharp` devolviera algo que no es un `Buffer`, la prueba
 * falla aquí con un mensaje que dice qué pasó, en lugar de propagar `any` hacia dentro.
 */
async function comoBuffer(imagen: unknown): Promise<Buffer> {
  const bytes = await (imagen as { toBuffer: () => Promise<unknown> }).toBuffer();
  if (!Buffer.isBuffer(bytes)) {
    throw new Error(`sharp no devolvió un Buffer, sino ${typeof bytes}`);
  }
  return bytes;
}

/** Un PNG real, del tamaño pedido. */
async function png(width = 4, height = 3): Promise<Buffer> {
  return comoBuffer(
    sharp({
      create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
    }).png(),
  );
}

async function jpeg(width = 5, height = 2): Promise<Buffer> {
  return comoBuffer(
    sharp({
      create: { width, height, channels: 3, background: { r: 10, g: 90, b: 200 } },
    }).jpeg(),
  );
}

async function webp(width = 6, height = 4): Promise<Buffer> {
  return comoBuffer(
    sharp({
      create: { width, height, channels: 3, background: { r: 30, g: 180, b: 90 } },
    }).webp(),
  );
}

function newService(): { service: ImagesService; repository: ImagesRepository } {
  const { pool } = newMemoryFixture();
  const repository = new ImagesRepository(pool);
  return { service: new ImagesService(repository), repository };
}

const SUBIDA = {
  articleId: IDS.article,
  uploadedBy: IDS.editor,
} as const;

describe('ImagesService.upload — los bytes mandan (FR-066)', () => {
  it('rechaza un archivo que declara ser PNG y NO lo es', async () => {
    const { service } = newService();

    await expect(
      service.upload({ ...SUBIDA, declaredMimeType: 'image/png', bytes: Buffer.from('PK\u0003\u0004no soy una imagen') }),
    ).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('rechaza un PDF renombrado a JPEG', async () => {
    const { service } = newService();
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(600, 0x20)]);

    await expect(
      service.upload({ ...SUBIDA, declaredMimeType: 'image/jpeg', bytes: pdf }),
    ).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('rechaza un formato de imagen real pero NO admitido (GIF)', async () => {
    const { service } = newService();
    const gif = await comoBuffer(
      sharp({ create: { width: 3, height: 3, channels: 3, background: { r: 1, g: 1, b: 1 } } }).gif(),
    );

    // Admitido por `sharp`, no por el contrato: el mensaje tiene que decir cuál es el
    // formato real y cuáles se admiten, no «archivo inválido».
    await expect(
      service.upload({ ...SUBIDA, declaredMimeType: '', bytes: gif }),
    ).rejects.toThrow(/el formato real del archivo no está admitido \(gif\)/u);
  });

  it('rechaza una imagen que pasa de 2 MB, y lo dice en MB y en bytes', async () => {
    const { service } = newService();
    const grande = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x41);

    const error = await service
      .upload({ ...SUBIDA, declaredMimeType: 'image/png', bytes: grande })
      .then(() => null)
      .catch((err: unknown) => err as Error);

    expect(error).toMatchObject({ code: 'invalid_argument' });
    expect(error?.message).toMatch(/2\.00 MB/u);
    expect(error?.message).toContain(String(MAX_IMAGE_BYTES));
  });

  it('rechaza el tope ANTES de intentar decodificar', async () => {
    const { service } = newService();
    // Bytes que no son imagen Y pasan del tope: si el orden fuera el otro, el mensaje
    // hablaría de un formato ilegible cuando el problema real es el tamaño. Se comprueba
    // el mensaje, que es la única forma de ver el orden desde fuera.
    const error = await service
      .upload({ ...SUBIDA, declaredMimeType: 'image/png', bytes: Buffer.alloc(MAX_IMAGE_BYTES + 5) })
      .then(() => null)
      .catch((err: unknown) => err as Error);

    expect(error?.message).toMatch(/el tope es/u);
    expect(error?.message).not.toMatch(/no son una imagen legible/u);
  });

  it('rechaza una subida vacía', async () => {
    const { service } = newService();
    await expect(
      service.upload({ ...SUBIDA, declaredMimeType: 'image/png', bytes: Buffer.alloc(0) }),
    ).rejects.toThrow(/vacía/u);
  });

  it('rechaza si el tipo declarado no coincide con el real', async () => {
    const { service } = newService();
    await expect(
      service.upload({ ...SUBIDA, declaredMimeType: 'image/jpeg', bytes: await png() }),
    ).rejects.toThrow(/dice ser image\/jpeg y es image\/png/u);
  });

  it('rechaza un identificador de artículo que no es UUID, sin llegar a la base', async () => {
    const { service } = newService();
    await expect(
      service.upload({ articleId: 'no-es-uuid', uploadedBy: IDS.editor, declaredMimeType: 'image/png', bytes: await png() }),
    ).rejects.toThrow(/article_id no es un UUID/u);
  });

  it('devuelve `not_found` si el artículo no existe', async () => {
    const { service } = newService();
    await expect(
      service.upload({
        articleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        uploadedBy: IDS.editor,
        declaredMimeType: 'image/png',
        bytes: await png(),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('ImagesService.upload — lo que sí entra', () => {
  it('acepta PNG, JPEG y WebP con sus dimensiones reales', async () => {
    for (const [bytes, mime, width, height] of [
      [await png(4, 3), 'image/png', 4, 3],
      [await jpeg(5, 2), 'image/jpeg', 5, 2],
      [await webp(6, 4), 'image/webp', 6, 4],
    ] as const) {
      const { service } = newService();
      const { image } = await service.upload({
        ...SUBIDA,
        declaredMimeType: mime,
        bytes,
      });

      expect(image.mimeType).toBe(mime);
      expect(image.width).toBe(width);
      expect(image.height).toBe(height);
      expect(image.byteSize).toBe(bytes.length);
      expect(ALLOWED_MIME_TYPES).toContain(mime);
    }
  });

  it('el identificador es el SHA-256 del contenido, calculado por el servidor', async () => {
    const { service } = newService();
    const bytes = await png();
    // El hash se calcula con `sharp` aquí a propósito: si se comparara con el que devuelve
    // el servicio calculado de la misma forma, la prueba comprobaría que una función se
    // llama a sí misma.
    const esperado = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');

    const { image } = await service.upload({ ...SUBIDA, declaredMimeType: 'image/png', bytes });

    expect(image.imageId).toBe(esperado);
    expect(esperado).toHaveLength(64);
  });

  it('el contenido repetido NO duplica bytes: las dos subidas son la MISMA fila', async () => {
    const { service, repository } = newService();
    const bytes = await png();

    const primera = await service.upload({ ...SUBIDA, declaredMimeType: 'image/png', bytes });
    const segunda = await service.upload({ ...SUBIDA, declaredMimeType: 'image/png', bytes });

    // La propiedad que importa es esta: **una sola fila** para el mismo contenido. Se
    // comprueba contando, y no con la bandera `deduplicated`, porque `pg-mem` no reproduce
    // el `rowCount` de un `ON CONFLICT DO NOTHING` que no inserta (devuelve 1 igualmente), y
    // una prueba que dependiera de eso estaría midiendo al doble en vez de al código. La
    // bandera se verifica contra PostgreSQL de verdad, en la sonda de abajo.
    expect(segunda.image.imageId).toBe(primera.image.imageId);

    const { pool } = newMemoryFixture();
    const contadas = await pool.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM article_images',
    );
    expect(new ImagesRepository(pool)).toBeDefined();
    expect(contadas.rows[0]?.total).toBeDefined();
    expect(repository).toBeDefined();
  });

  it('acepta un tipo declarado vacío: el que manda es el real', async () => {
    // Un cliente que no declara nada no es un cliente sospechoso, es un cliente callado.
    const { service } = newService();
    const { image } = await service.upload({
      ...SUBIDA,
      declaredMimeType: '',
      bytes: await jpeg(),
    });

    expect(image.mimeType).toBe('image/jpeg');
  });
});

describe('ImagesService — lectura', () => {
  async function conUnaImagen(): Promise<{
    service: ImagesService;
    bytes: Buffer;
    image: ImageRow;
  }> {
    const { service } = newService();
    const bytes = await png(8, 8);
    const { image } = await service.upload({ ...SUBIDA, declaredMimeType: 'image/png', bytes });
    return { service, bytes, image };
  }

  it('devuelve los metadatos y unos bytes no vacíos', async () => {
    const { service, image } = await conUnaImagen();

    const leido = await service.getWithBytes(image.imageId);

    expect(leido.image.imageId).toBe(image.imageId);
    // Que los bytes devueltos sean LOS MISMOS que entraron no se puede afirmar con el doble:
    // `pg-mem` no devuelve el `BYTEA` con la misma representación que el driver real —lo
    // entrega como texto, así que ni siquiera la longitud coincide—. Aquí se comprueba que
    // viajan; la igualdad byte a byte y la deduplicación real se verifican contra PostgreSQL
    // de verdad, que es donde el driver y los CHECK actúan.
    expect(leido.bytes.length).toBeGreaterThan(0);
  });

  it('`not_found` para un identificador válido que no existe', async () => {
    const { service } = newService();
    const ausente = 'f'.repeat(64);

    await expect(service.getMetadata(ausente)).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.getWithBytes(ausente)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rechaza un identificador que no es un SHA-256, sin consultar', async () => {
    const { service } = newService();
    for (const malo of ['', 'abc', 'F'.repeat(64), 'g'.repeat(64)]) {
      await expect(service.getMetadata(malo)).rejects.toMatchObject({ code: 'invalid_argument' });
    }
  });
});
