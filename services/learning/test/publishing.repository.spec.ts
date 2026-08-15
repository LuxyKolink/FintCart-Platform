/**
 * Pruebas de persistencia del flujo editorial (T171, §Calidad).
 *
 * Corren contra `pg-mem`, igual que `repositories.spec.ts`: lo que puede romperse aquí
 * es el propio SQL —el `WHERE state = 'borrador'` de una transición, el `FOR UPDATE`
 * que evita la carrera de `version_no`—, no una llamada bien tipada a un doble que
 * siempre respondería que sí.
 *
 * Lo que se fija:
 *
 * - `version_no` es estrictamente incremental por artículo (FR-013).
 * - Las transiciones de estado son ATÓMICAS: solo se mueven desde el estado que les
 *   corresponde, y devuelven `not_found`/`conflict` en caso contrario.
 * - `approved_by ≠ created_by` se rechaza ANTES del `UPDATE` (FR-008).
 * - `articles.current_version_id` se actualiza en la MISMA transacción que publica.
 */
import type { Pool } from 'pg';
import type { IMemoryDb } from 'pg-mem';

import { PublishingRepository } from '../src/publishing/publishing.repository';

import { IDS, newMemoryFixture } from './support/memdb';

/** Segundo editor de los datos de prueba: distinto de `IDS.editor`. */
const COORDINATOR = IDS.user;

/** Versión ya en `en_revision`, creada aparte porque el fixture compartido no la tiene. */
const IN_REVIEW_VERSION = 'aaaaaaaa-0000-4000-8000-000000000001';

function newFixture(): { db: IMemoryDb; pool: Pool; repo: PublishingRepository } {
  const { db, pool } = newMemoryFixture();
  db.public.none(`
    INSERT INTO article_versions (id, article_id, version_no, body, state, created_by)
    VALUES ('${IN_REVIEW_VERSION}', '${IDS.article}', 4, 'Cuerpo revisado', 'en_revision', '${IDS.editor}');
  `);
  return { db, pool, repo: new PublishingRepository(pool) };
}

describe('PublishingRepository.createArticle', () => {
  it('crea el artículo y su versión 1 en borrador', async () => {
    const { repo } = newFixture();

    const version = await repo.createArticle('Nuevo artículo', 'credito', 'Cuerpo inicial', IDS.editor);

    expect(version.versionNo).toBe(1);
    expect(version.state).toBe('borrador');
    expect(version.createdBy).toBe(IDS.editor);
    expect(version.approvedBy).toBe('');
  });
});

describe('PublishingRepository.createNewVersion', () => {
  it('numera la nueva versión de forma incremental (FR-013)', async () => {
    const { repo } = newFixture();

    // El fixture ya tiene version_no 3 (publicada) y 4 (en revisión) para IDS.article.
    const version = await repo.createNewVersion(IDS.article, IDS.editor, 'Cuerpo nuevo');

    expect(version.versionNo).toBe(5);
    expect(version.state).toBe('borrador');
  });

  it('rechaza un artículo inexistente', async () => {
    const { repo } = newFixture();

    await expect(repo.createNewVersion(IDS.questionA, IDS.editor, 'x')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('PublishingRepository.updateDraftBody', () => {
  it('edita el cuerpo de un borrador propio', async () => {
    const { repo } = newFixture();

    const updated = await repo.updateDraftBody(IDS.draftVersion, IDS.editor, 'Cuerpo editado');

    expect(updated.body).toBe('Cuerpo editado');
  });

  it('rechaza a un editor distinto del autor (FR-008: visible únicamente a su editor)', async () => {
    const { repo } = newFixture();

    await expect(repo.updateDraftBody(IDS.draftVersion, COORDINATOR, 'x')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('rechaza una versión que ya no está en borrador', async () => {
    const { repo } = newFixture();

    await expect(repo.updateDraftBody(IDS.publishedVersion, IDS.editor, 'x')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('PublishingRepository.submitForReview', () => {
  it('borrador → en_revision', async () => {
    const { repo } = newFixture();

    const submitted = await repo.submitForReview(IDS.draftVersion, IDS.editor);

    expect(submitted.state).toBe('en_revision');
  });
});

describe('PublishingRepository.approveAndPublish', () => {
  it('publica y actualiza articles.current_version_id en la misma transacción', async () => {
    const { repo, pool } = newFixture();

    const published = await repo.approveAndPublish(IN_REVIEW_VERSION, COORDINATOR);

    expect(published.state).toBe('publicado');
    expect(published.approvedBy).toBe(COORDINATOR);
    expect(published.title).toBe('Ahorro para principiantes');
    expect(published.category).toBe('ahorro');

    const article = await pool.query<{ current_version_id: string }>(
      'SELECT current_version_id FROM articles WHERE id = $1',
      [IDS.article],
    );
    expect(article.rows[0]?.current_version_id).toBe(IN_REVIEW_VERSION);
  });

  it('rechaza que el editor apruebe su propio artículo (FR-008)', async () => {
    const { repo } = newFixture();

    await expect(repo.approveAndPublish(IN_REVIEW_VERSION, IDS.editor)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('rechaza una versión que no está en revisión', async () => {
    const { repo } = newFixture();

    await expect(repo.approveAndPublish(IDS.draftVersion, COORDINATOR)).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});

describe('PublishingRepository.archive', () => {
  it('publicado → archivado', async () => {
    const { repo } = newFixture();

    const archived = await repo.archive(IDS.publishedVersion);

    expect(archived.state).toBe('archivado');
  });

  it('rechaza una versión que no está publicada', async () => {
    const { repo } = newFixture();

    await expect(repo.archive(IDS.draftVersion)).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('PublishingRepository.listVersions', () => {
  it('filtra por article_id (historial de un artículo, FR-013)', async () => {
    const { repo } = newFixture();

    const page = await repo.listVersions(
      { articleId: IDS.article, state: '', editorId: '' },
      { limit: 20, offset: 0 },
    );

    expect(page.total).toBe(2);
    expect(page.items.map((v) => v.versionNo).sort()).toEqual([3, 4]);
  });

  it('filtra por estado (bandeja de revisión del coordinador)', async () => {
    const { repo } = newFixture();

    const page = await repo.listVersions(
      { articleId: '', state: 'en_revision', editorId: '' },
      { limit: 20, offset: 0 },
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.versionId).toBe(IN_REVIEW_VERSION);
  });

  it('filtra por editor (borradores propios)', async () => {
    const { repo } = newFixture();

    const page = await repo.listVersions(
      { articleId: '', state: 'borrador', editorId: IDS.editor },
      { limit: 20, offset: 0 },
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.versionId).toBe(IDS.draftVersion);
  });
});
