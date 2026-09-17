/**
 * Invariante de separación de responsabilidades (T155, FR-008).
 *
 * `PublishingRepository.approveAndPublish` YA la comprueba (`publishing.repository.spec.ts`,
 * T171); esta prueba corre un nivel más arriba, contra `PublishingService`, para fijar
 * que la capa de aplicación no introduce una ruta que la salte —por ejemplo, validando
 * el UUID y despachando directo al repositorio sin pasar por la comprobación— y que el
 * intento de un editor de publicar su propio artículo llega hasta aquí como el mismo
 * error de dominio (`forbidden`) que espera `learning.controller.ts::codeOf`.
 */
import type { Pool } from 'pg';

import { CategoriesRepository } from '../src/categories/categories.repository';
import { CategoriesService } from '../src/categories/categories.service';
import { EventsPublisher } from '../src/events/publisher';
import { ImagesRepository } from '../src/images/images.repository';
import { ImagesService } from '../src/images/images.service';
import { PublishingRepository } from '../src/publishing/publishing.repository';
import { PublishingService } from '../src/publishing/publishing.service';
import { VersioningService } from '../src/publishing/versioning.service';

import { FakePublishedCalculators } from './support/calculators';
import { IDS, newMemoryFixture } from './support/memdb';

const COORDINATOR = IDS.user;

function newFixture(): { pool: Pool; service: PublishingService } {
  const { pool } = newMemoryFixture();
  const repository = new PublishingRepository(pool);
  // Host inalcanzable a propósito: `EventsPublisher.publishArticlePublished` nunca
  // lanza (ver su cabecera), así que esta prueba no necesita un broker real para
  // comprobar el invariante de dominio.
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

describe('PublishingService.approveAndPublish — FR-008', () => {
  it('un editor NO puede aprobar ni publicar su propio artículo', async () => {
    const { service } = newFixture();
    await service.submitForReview(IDS.draftVersion, IDS.editor);

    await expect(service.approveAndPublish(IDS.draftVersion, IDS.editor)).rejects.toMatchObject({
      code: 'forbidden',
    });

    // Y el estado NO avanzó: sigue en revisión, no publicado a medias.
    const stillInReview = await service.listVersions(
      { articleId: IDS.draftArticle, state: 'en_revision', editorId: '' },
      undefined,
    );
    expect(stillInReview.items).toHaveLength(1);
  });

  it('un coordinador editorial DISTINTO sí puede aprobar y publicar', async () => {
    const { service } = newFixture();
    await service.submitForReview(IDS.draftVersion, IDS.editor);

    const published = await service.approveAndPublish(IDS.draftVersion, COORDINATOR);

    expect(published.state).toBe('publicado');
    expect(published.approvedBy).toBe(COORDINATOR);
    expect(published.approvedBy).not.toBe(published.createdBy);
  });

  it('rechaza publicar un borrador que nunca se envió a revisión', async () => {
    const { service } = newFixture();

    await expect(service.approveAndPublish(IDS.draftVersion, COORDINATOR)).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
