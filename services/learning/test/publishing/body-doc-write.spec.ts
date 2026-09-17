/**
 * El cuerpo que llega se valida Y se persiste con una sola fuente de verdad (T131, T128).
 *
 * Tres cosas se fijan aquí, y las tres se rompen en silencio si se aflojan:
 *
 *   1. **Un documento que llega MANDA.** El servicio no vuelve a derivarlo del texto: si
 *      lo hiciera, el editor guardaría una cosa y el lector mostraría otra —negritas,
 *      encabezados, listas e imágenes desaparecerían al guardar sin ningún error—, que es
 *      el peor fallo posible en un editor.
 *   2. **El documento se valida antes de escribir.** Un nodo fuera del vocabulario, un
 *      enlace `javascript:` o una imagen que no existe se rechazan con `invalid_argument`
 *      —400 en el borde— y no con un error interno.
 *   3. **El texto se DERIVA del documento** cuando hay documento. Guardar los dos tal como
 *      lleguen dejaría dos versiones del mismo cuerpo que pueden contradecirse.
 *
 * Corre contra `pg-mem`: lo que se comprueba es la decisión de la capa de aplicación y el
 * camino hasta el SQL, no el motor.
 */
import type { Pool } from 'pg';

import { CategoriesRepository } from '../../src/categories/categories.repository';
import { CategoriesService } from '../../src/categories/categories.service';
import { EventsPublisher } from '../../src/events/publisher';
import { ImagesRepository } from '../../src/images/images.repository';
import { ImagesService } from '../../src/images/images.service';
import { parseBodyDoc } from '../../src/grpc/mapping';
import { bodyDocToPlainText } from '../../src/articles/plain-text';
import { PublishingRepository } from '../../src/publishing/publishing.repository';
import { PublishingService } from '../../src/publishing/publishing.service';
import { VersioningService } from '../../src/publishing/versioning.service';

import { FakePublishedCalculators } from '../support/calculators';
import { IDS, newMemoryFixture } from '../support/memdb';

/** SHA-256 de contenido: la forma que exige el vocabulario para `image_id`. */
const IMAGEN = 'a'.repeat(64);
const IMAGEN_QUE_NO_ESTA = 'b'.repeat(64);

/** Un párrafo con texto. */
function parrafo(texto: string, marcas?: unknown): Record<string, unknown> {
  const nodo: Record<string, unknown> = { tipo: 'texto', texto };
  if (marcas !== undefined) {
    nodo['marcas'] = marcas;
  }
  return { tipo: 'parrafo', contenido: [nodo] };
}

/** El documento del caso feliz: encabezado, párrafo con negrita, lista e imagen. */
const DOCUMENTO = {
  tipo: 'doc',
  contenido: [
    { tipo: 'encabezado', nivel: 2, contenido: [{ tipo: 'texto', texto: 'Cuánto ahorrar' }] },
    parrafo('Ahorra ', [{ tipo: 'negrita' }]),
    parrafo('primero', [{ tipo: 'negrita' }]),
    {
      tipo: 'lista',
      ordenada: false,
      contenido: [
        { tipo: 'item_lista', contenido: [parrafo('Fijos')] },
        { tipo: 'item_lista', contenido: [parrafo('Variables')] },
      ],
    },
    { tipo: 'imagen', image_id: IMAGEN, alt: 'Una alcancía', pie: 'Figura 1' },
  ],
};

function newFixture(): { pool: Pool; service: PublishingService } {
  const { pool } = newMemoryFixture();
  const repository = new PublishingRepository(pool);
  const events = new EventsPublisher('amqp://127.0.0.1:1');
  const categories = new CategoriesService(new CategoriesRepository(pool), events);
  return {
    pool,
    service: new PublishingService(
      repository,
      new VersioningService(repository),
      events,
      categories,
      new ImagesService(new ImagesRepository(pool)),
      // Ninguna calculadora publicada: lo que hace falta para T149 es que el doble se pueda
      // configurar; las pruebas que incrustan una calculadora usan su propio doble.
      new FakePublishedCalculators(),
    ),
  };
}

/** Registra una imagen con ese identificador para que la referencia exista. */
async function insertarImagen(pool: Pool, imageId: string): Promise<void> {
  await pool.query(
    `INSERT INTO article_images (id, article_id, mime_type, byte_size, width, height, bytes, uploaded_by)
     VALUES ($1, $2, 'image/png', 4, 2, 2, $3, $4)`,
    [imageId, IDS.article, Buffer.from([1, 2, 3, 4]), IDS.editor],
  );
}

describe('el documento que llega manda (T131)', () => {
  it('`updateDraft` guarda el documento TAL CUAL, sin volver a derivarlo del texto', async () => {
    const { pool, service } = newFixture();
    await insertarImagen(pool, IMAGEN);

    const version = await service.updateDraft(IDS.draftVersion, IDS.editor, '', DOCUMENTO);

    expect(version.bodyDoc).toEqual(DOCUMENTO);
    // Y contra la fila, no solo contra el valor de retorno: el `UPDATE` nombra la
    // columna, y un `body_doc` que se quedara fuera del `SET` se vería igual aquí.
    const fila = await pool.query<{ body_doc: unknown }>(
      'SELECT body_doc FROM article_versions WHERE id = $1',
      [IDS.draftVersion],
    );
    expect(fila.rows[0]?.body_doc).toEqual(DOCUMENTO);
  });

  it('conserva lo que el texto plano no puede representar (encabezado, lista, negrita)', async () => {
    const { pool, service } = newFixture();
    await insertarImagen(pool, IMAGEN);

    const version = await service.updateDraft(IDS.draftVersion, IDS.editor, '', DOCUMENTO);

    expect(version.bodyDoc).toEqual(DOCUMENTO);
    // El contraste que importa: el TEXTO que se deriva del documento pierde la estructura
    // —no tiene forma de representarla— y por eso no puede ser la fuente de verdad. Si
    // estas dos afirmaciones se parecieran, el documento no estaría aportando nada.
    const textoQueVeráUnLectorDe001 = bodyDocToPlainText(version.bodyDoc);
    expect(textoQueVeráUnLectorDe001).toContain('Cuánto ahorrar');
    expect(textoQueVeráUnLectorDe001).not.toContain('negrita');
  });

  it('el texto se DERIVA del documento cuando hay documento', async () => {
    const { pool, service } = newFixture();
    await insertarImagen(pool, IMAGEN);

    // El texto que llega dice una cosa y el documento otra: gana el documento, que es lo
    // único que se guarda. El texto que llega no se persiste en ningún sitio.
    const version = await service.updateDraft(IDS.draftVersion, IDS.editor, 'texto viejo', DOCUMENTO);

    const textoDerivado = bodyDocToPlainText(version.bodyDoc);
    expect(textoDerivado).not.toContain('texto viejo');
    expect(textoDerivado).toContain('Cuánto ahorrar');
    expect(textoDerivado).toContain('Fijos');
  });

  it('`createDraft` también acepta documento y lo guarda', async () => {
    const { pool, service } = newFixture();
    await insertarImagen(pool, IMAGEN);

    const version = await service.createDraft('Título', IDS.categoryAhorro, '', IDS.editor, '', DOCUMENTO);

    expect(version.bodyDoc).toEqual(DOCUMENTO);
  });

  it('una nueva versión de un artículo existente acepta documento', async () => {
    const { pool, service } = newFixture();
    await insertarImagen(pool, IMAGEN);

    const version = await service.createDraft('', '', '', IDS.editor, IDS.article, DOCUMENTO);

    expect(version.bodyDoc).toEqual(DOCUMENTO);
  });
});

describe('un documento fuera del vocabulario se rechaza con 400, no con 500 (T131, T134)', () => {
  it('un nodo no admitido se rechaza y el borrador queda intacto', async () => {
    const { pool, service } = newFixture();
    // Se lee el documento y NO un texto plano: desde T135 la columna `body` no existe, y
    // el estado del borrador es exactamente su documento.
    const antes = await pool.query<{ body_doc: unknown }>(
      'SELECT body_doc FROM article_versions WHERE id = $1',
      [IDS.draftVersion],
    );

    await expect(
      service.updateDraft(IDS.draftVersion, IDS.editor, '', {
        tipo: 'doc',
        contenido: [{ tipo: 'script', contenido: [{ tipo: 'texto', texto: 'alert(1)' }] }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' });

    const despues = await pool.query<{ body_doc: unknown }>(
      'SELECT body_doc FROM article_versions WHERE id = $1',
      [IDS.draftVersion],
    );
    // Lo importante no es que lance, sino que NO dejó a medias: el borrador sigue como
    // estaba. Un rechazo que ya hubiera escrito el cuerpo sería peor que no validar.
    expect(despues.rows[0]).toEqual(antes.rows[0]);
  });

  it('un enlace con esquema `javascript:` se rechaza', async () => {
    const { service } = newFixture();

    await expect(
      service.updateDraft(IDS.draftVersion, IDS.editor, '', {
        tipo: 'doc',
        contenido: [parrafo('pulsa', [{ tipo: 'enlace', href: 'javascript:alert(1)' }])],
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('una imagen sin `alt` se rechaza: el vocabulario lo exige', async () => {
    const { pool, service } = newFixture();
    await insertarImagen(pool, IMAGEN);

    await expect(
      service.updateDraft(IDS.draftVersion, IDS.editor, '', {
        tipo: 'doc',
        contenido: [{ tipo: 'imagen', image_id: IMAGEN }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('un documento vacío se rechaza: una versión sin bloques no tiene nada que publicar', async () => {
    const { service } = newFixture();

    await expect(
      service.updateDraft(IDS.draftVersion, IDS.editor, '', { tipo: 'doc', contenido: [] }),
    ).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('un texto en blanco sin documento también se rechaza (camino heredado)', async () => {
    const { service } = newFixture();

    await expect(service.updateDraft(IDS.draftVersion, IDS.editor, '   \n  ')).rejects.toMatchObject({
      code: 'invalid_argument',
    });
  });
});

describe('una imagen que no existe se rechaza al guardar (T128)', () => {
  it('nombra el identificador que falta', async () => {
    const { service } = newFixture();

    const intento = service.updateDraft(IDS.draftVersion, IDS.editor, '', {
      tipo: 'doc',
      contenido: [parrafo('Con imagen'), { tipo: 'imagen', image_id: IMAGEN_QUE_NO_ESTA, alt: 'x' }],
    });

    await expect(intento).rejects.toMatchObject({ code: 'invalid_argument' });
    // El mensaje nombra el identificador que falta: sin él, quien edita ve «hay una
    // imagen rota» y tiene que adivinar cuál de las doce de su artículo es.
    await expect(intento).rejects.toThrow(IMAGEN_QUE_NO_ESTA);
  });

  it('una imagen que SÍ existe no se rechaza', async () => {
    const { pool, service } = newFixture();
    await insertarImagen(pool, IMAGEN);

    const version = await service.updateDraft(IDS.draftVersion, IDS.editor, '', {
      tipo: 'doc',
      contenido: [parrafo('Con imagen'), { tipo: 'imagen', image_id: IMAGEN, alt: 'Una alcancía' }],
    });

    expect(version.bodyDoc).toEqual({
      tipo: 'doc',
      contenido: [parrafo('Con imagen'), { tipo: 'imagen', image_id: IMAGEN, alt: 'Una alcancía' }],
    });
  });

  it('una imagen repetida se consulta una sola vez y no se queja', async () => {
    const { pool, service } = newFixture();
    await insertarImagen(pool, IMAGEN);

    const version = await service.updateDraft(IDS.draftVersion, IDS.editor, '', {
      tipo: 'doc',
      contenido: [
        { tipo: 'imagen', image_id: IMAGEN, alt: 'A' },
        { tipo: 'imagen', image_id: IMAGEN, alt: 'B' },
      ],
    });

    expect(version.bodyDoc?.contenido).toHaveLength(2);
  });
});

describe('el camino heredado sigue funcionando (T124)', () => {
  it('sin documento, el texto se convierte con la regla de siempre', async () => {
    const { service } = newFixture();

    const version = await service.updateDraft(IDS.draftVersion, IDS.editor, 'Primero.\n\nSegundo.');

    expect(version.bodyDoc).toEqual({
      tipo: 'doc',
      contenido: [
        { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Primero.' }] },
        { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Segundo.' }] },
      ],
    });
    expect(bodyDocToPlainText(version.bodyDoc)).toBe('Primero.\n\nSegundo.');
  });
});

describe('`body_doc` llega como CADENA de JSON y se analiza una sola vez (T131)', () => {
  it('una cadena vacía significa «no lo mandaron»', () => {
    expect(parseBodyDoc(undefined)).toBeNull();
    expect(parseBodyDoc('')).toBeNull();
    expect(parseBodyDoc('   ')).toBeNull();
  });

  it('un documento viaja como objeto', () => {
    expect(parseBodyDoc('{"tipo":"doc","contenido":[]}')).toEqual({ tipo: 'doc', contenido: [] });
  });

  it('un JSON ilegible es `invalid_argument`, no un cuerpo vacío guardado en silencio', () => {
    expect(() => parseBodyDoc('{no es json}')).toThrow(/body_doc no es JSON legible/);
  });
});
