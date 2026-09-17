/**
 * Un artículo no puede incrustar una calculadora que el lector no podría ejecutar (T149, FR-070).
 *
 * ## Por qué esta prueba vive aquí y no en `body-doc.validator.spec.ts`
 *
 * T149 pedía añadirla al validador, y el validador **no puede** responderla: su cabecera lo dice
 * desde T123 —«no comprueba que la imagen o la calculadora existan (…) eso vive donde se puede
 * comprobar: por gRPC contra el Simulador»—. Un validador que consultara al Simulador dejaría de
 * ser una función pura y ninguna prueba de vocabulario podría correr sin levantar medio sistema.
 *
 * Así que lo que se comprueba aquí es la REGLA del camino de guardado, con el puerto sustituido
 * por un doble: que un documento con una calculadora no publicada se rechace **nombrando cuál**,
 * que se acepte cuando está publicada, y —las dos que se olvidan— que no se pregunte cuando no hay
 * calculadoras y que una caída del Simulador NO se confunda con una calculadora no publicada.
 *
 * Corre contra `pg-mem`: se prueba la decisión de la capa de aplicación, no el motor.
 */
import type { Pool } from 'pg';

import { unavailable } from '../../src/common/errors';
import { CategoriesRepository } from '../../src/categories/categories.repository';
import { CategoriesService } from '../../src/categories/categories.service';
import { EventsPublisher } from '../../src/events/publisher';
import { ImagesRepository } from '../../src/images/images.repository';
import { ImagesService } from '../../src/images/images.service';
import { PublishingRepository } from '../../src/publishing/publishing.repository';
import { PublishingService } from '../../src/publishing/publishing.service';
import { VersioningService } from '../../src/publishing/versioning.service';

import { FakePublishedCalculators } from '../support/calculators';
import { IDS, newMemoryFixture } from '../support/memdb';

const PUBLICADA = '11111111-1111-4111-8111-111111111111';
const PRIVADA = '22222222-2222-4222-8222-222222222222';

/** Un documento con una calculadora incrustada, con la versión que exige el vocabulario. */
function documentoCon(calculatorId: string, version = 1): unknown {
  return {
    tipo: 'doc',
    contenido: [
      { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Calcula tu cuota:' }] },
      { tipo: 'calculadora', calculator_id: calculatorId, version },
    ],
  };
}

/** Un documento válido sin calculadoras, para el caso de «no se pregunta». */
const SIN_CALCULADORAS = {
  tipo: 'doc',
  contenido: [{ tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Solo texto' }] }],
};

function newFixture(
  doble: FakePublishedCalculators,
): { pool: Pool; service: PublishingService } {
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
      doble,
    ),
  };
}

describe('FR-070 — solo se incrusta una calculadora publicada', () => {
  it('rechaza el documento y NOMBRA la calculadora que no está publicada', async () => {
    const doble = new FakePublishedCalculators([PUBLICADA]);
    const { service } = newFixture(doble);

    // El mensaje importa tanto como el rechazo: «hay una calculadora mal» sin decir cuál
    // obliga a quien escribe a adivinar entre las tres que incrustó.
    await expect(
      service.updateDraft(IDS.draftVersion, IDS.editor, '', documentoCon(PRIVADA)),
    ).rejects.toThrow(/no está publicada/);
    await expect(
      service.updateDraft(IDS.draftVersion, IDS.editor, '', documentoCon(PRIVADA)),
    ).rejects.toThrow(new RegExp(PRIVADA));
  });

  it('nombra TODAS las que faltan, y no solo la primera', async () => {
    const otra = '33333333-3333-4333-8333-333333333333';
    const doble = new FakePublishedCalculators([]);
    const { service } = newFixture(doble);

    const doc = {
      tipo: 'doc',
      contenido: [
        { tipo: 'calculadora', calculator_id: PRIVADA, version: 1 },
        { tipo: 'calculadora', calculator_id: otra, version: 2 },
      ],
    };
    await expect(service.updateDraft(IDS.draftVersion, IDS.editor, '', doc)).rejects.toThrow(
      new RegExp(`2 calculadoras.*${PRIVADA}.*${otra}`, 's'),
    );
  });

  it('acepta el documento cuando está publicada, y lo guarda con la versión fijada', async () => {
    const doble = new FakePublishedCalculators([PUBLICADA]);
    const { service } = newFixture(doble);

    const version = await service.updateDraft(
      IDS.draftVersion,
      IDS.editor,
      '',
      documentoCon(PUBLICADA, 3),
    );

    expect(version.bodyDoc).toEqual(documentoCon(PUBLICADA, 3));
    expect(doble.llamadas).toBe(1);
  });

  it('pregunta UNA vez por identificador aunque el documento lo repita', async () => {
    const doble = new FakePublishedCalculators([PUBLICADA]);
    const { service } = newFixture(doble);

    const doc = {
      tipo: 'doc',
      contenido: [
        { tipo: 'calculadora', calculator_id: PUBLICADA, version: 1 },
        { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'y otra vez abajo:' }] },
        { tipo: 'calculadora', calculator_id: PUBLICADA, version: 1 },
      ],
    };
    await service.updateDraft(IDS.draftVersion, IDS.editor, '', doc);

    // Incrustar la misma calculadora dos veces es legítimo; preguntar dos veces por ella, no.
    expect(doble.preguntas).toEqual([[PUBLICADA]]);
  });

  it('NO pregunta al Simulador cuando el documento no tiene calculadoras', async () => {
    const doble = new FakePublishedCalculators([]);
    const { service } = newFixture(doble);

    await service.updateDraft(IDS.draftVersion, IDS.editor, '', SIN_CALCULADORAS);

    // La mayoría de los guardados no lleva calculadoras: cada uno de ellos costaría una ida y
    // vuelta de red al Simulador por nada.
    expect(doble.llamadas).toBe(0);
  });

  it('un Simulador caído NO se lee como «la calculadora no está publicada»', async () => {
    const doble = new FakePublishedCalculators(
      [],
      unavailable('simulador', 'comprobar si una calculadora está publicada', new Error('sin ruta')),
    );
    const { service } = newFixture(doble);

    // La distinción es la que evita el peor diagnóstico posible: con el Simulador caído, decirle
    // al autor que su calculadora no está publicada le manda a arreglar algo que no está roto.
    await expect(
      service.updateDraft(IDS.draftVersion, IDS.editor, '', documentoCon(PUBLICADA)),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('la comprobación de la calculadora no sustituye a la de las imágenes', async () => {
    const doble = new FakePublishedCalculators([PUBLICADA]);
    const { service } = newFixture(doble);

    // Un documento con una imagen que no existe Y una calculadora publicada: se rechaza por la
    // imagen, que es la comprobación que vive en esta base. Si la calculadora hubiera pasado por
    // delante, el mensaje culparía a la calculadora de un problema de la imagen.
    const doc = {
      tipo: 'doc',
      contenido: [
        { tipo: 'imagen', image_id: 'f'.repeat(64), alt: 'Una foto' },
        { tipo: 'calculadora', calculator_id: PUBLICADA, version: 1 },
      ],
    };
    await expect(service.updateDraft(IDS.draftVersion, IDS.editor, '', doc)).rejects.toThrow(
      /imagen que no existe/,
    );
  });
});
