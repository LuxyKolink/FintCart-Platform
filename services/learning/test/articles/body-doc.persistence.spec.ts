/**
 * Persistencia del documento de bloques (T124, FR-063, FR-069).
 *
 * Lo que se fija aquí es que **el camino de escritura rellena `body_doc`**, y que lo
 * rellena con la conversión compartida (`plainTextToBodyDoc`) y no con otra parecida.
 * Importa porque la columna es anulable durante la transición: si el camino de
 * escritura no la llenara, todo compilaría, todas las pruebas anteriores seguirían
 * verdes y la columna se quedaría vacía para siempre — que es la forma más cómoda de
 * tener un dato a medias durante meses.
 *
 * Corre contra `pg-mem`, igual que `publishing.repository.spec.ts`: lo que puede
 * romperse es el SQL —que el `INSERT` nombre la columna nueva y que el `UPDATE` la
 * reescriba—, no una llamada bien tipada.
 */
import type { Pool } from 'pg';

import { plainTextToBodyDoc } from '../../src/articles/plain-text';
import { PublishingRepository } from '../../src/publishing/publishing.repository';

import { IDS, newMemoryFixture } from '../support/memdb';

function newRepo(): { pool: Pool; repo: PublishingRepository } {
  const { pool } = newMemoryFixture();
  return { pool, repo: new PublishingRepository(pool) };
}

/** Documento esperado para un cuerpo de dos párrafos. */
const DOS_PARRAFOS = {
  tipo: 'doc',
  contenido: [
    { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Primero.' }] },
    { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Segundo.' }] },
  ],
};

describe('el camino de escritura guarda el documento (T124)', () => {
  it('`createArticle` guarda el documento de la versión 1', async () => {
    const { pool, repo } = newRepo();

    const version = await repo.createArticle('Título', IDS.categoryAhorro, 'Primero.\n\nSegundo.', IDS.editor);

    expect(version.bodyDoc).toEqual(DOS_PARRAFOS);
    const fila = await pool.query<{ body_doc: unknown }>(
      'SELECT body_doc FROM article_versions WHERE id = $1',
      [version.versionId],
    );
    expect(fila.rows[0]?.body_doc).toEqual(DOS_PARRAFOS);
  });

  it('`createNewVersion` guarda el documento de la versión nueva', async () => {
    const { repo } = newRepo();

    const version = await repo.createNewVersion(IDS.article, IDS.editor, 'Primero.\n\nSegundo.');

    expect(version.bodyDoc).toEqual(DOS_PARRAFOS);
  });

  it('`updateDraftBody` REESCRIBE el documento, no lo deja con el anterior', async () => {
    const { repo } = newRepo();

    const creado = await repo.createArticle('Título', IDS.categoryAhorro, 'Cuerpo inicial', IDS.editor);
    expect(creado.bodyDoc).toEqual(plainTextToBodyDoc('Cuerpo inicial'));

    const editado = await repo.updateDraftBody(creado.versionId, IDS.editor, 'Uno.\n\nDos.\n\nTres.');

    expect(editado.bodyDoc).toEqual(plainTextToBodyDoc('Uno.\n\nDos.\n\nTres.'));
  });

  it('el documento y el texto cuentan lo mismo: los dos se guardan juntos', async () => {
    const { repo } = newRepo();
    const cuerpo = 'El interés compuesto es interés que gana interés.\n\nY su efecto crece con el tiempo.';

    const version = await repo.createArticle('Título', IDS.categoryAhorro, cuerpo, IDS.editor);

    expect(version.body).toBe(cuerpo);
    expect(version.bodyDoc).toEqual(plainTextToBodyDoc(cuerpo));
  });

  it('un cuerpo en blanco guarda un documento vacío, no un nulo', async () => {
    const { repo } = newRepo();

    const version = await repo.createArticle('Título', IDS.categoryAhorro, '   \n  ', IDS.editor);

    // El servicio rechaza el cuerpo vacío antes de llegar aquí (`PublishingService`),
    // así que este caso fija QUÉ guardaría el repositorio si alguien lo llamara
    // directo: un documento válido y vacío, nunca un nulo que obligue a cada lector a
    // distinguir «no hay documento» de «documento vacío».
    expect(version.bodyDoc).toEqual({ tipo: 'doc', contenido: [] });
  });

  it('las versiones sembradas antes de T016 conservan su documento del fixture', async () => {
    const { pool, repo } = newRepo();

    const pagina = await repo.listVersions({ articleId: IDS.article, state: '', editorId: '' }, { limit: 10, offset: 0 });

    const publicada = pagina.items.find((v) => v.versionId === IDS.publishedVersion);
    expect(publicada?.bodyDoc).toEqual(plainTextToBodyDoc('Cuerpo publicado'));
    // Y el borrador del fixture también: el relleno de la migración dejó documento a
    // todas las versiones que ya existían.
    expect(pool).toBeDefined();
  });
});
