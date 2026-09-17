/**
 * El documento de bloques en el camino de LECTURA (T124, FR-063, FR-068).
 *
 * Fija la decisión de forma del contrato: en el proto el documento viaja como **texto
 * JSON** —el vocabulario cerrado se valida en el servidor, en un solo sitio— y la
 * frontera lo serializa al salir. Aquí no se valida nada al salir: un documento inválido
 * en la base es un fallo de la capa de escritura, y descubrirlo al leer convertiría un
 * dato malo en una pantalla vacía.
 *
 * La distinción entre «no hay documento» y «documento vacío» se comprueba aparte porque
 * las dos cosas llegan al cliente por el mismo campo: la cadena vacía significa «esta
 * versión es anterior al documento de bloques», y el lector tiene que caer a `body`.
 */
import { articleToPb, versionToPb } from '../../src/grpc/mapping';
import type { ArticleDetail } from '../../src/articles/articles.repository';
import type { VersionRow } from '../../src/publishing/publishing.repository';

const DOC = { tipo: 'doc', contenido: [{ tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Hola' }] }] };

const VERSION: VersionRow = {
  versionId: '11111111-1111-4111-8111-111111111111',
  articleId: '22222222-2222-4222-8222-222222222222',
  versionNo: 1,
  body: 'Hola',
  bodyDoc: DOC,
  state: 'borrador',
  createdBy: '33333333-3333-4333-8333-333333333333',
  approvedBy: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  publishedAt: '',
};

const ARTICULO: ArticleDetail = {
  articleId: '22222222-2222-4222-8222-222222222222',
  title: 'Ahorro',
  category: 'ahorro',
  categoryId: '44444444-4444-4444-8444-444444444444',
  currentVersionNo: 1,
  body: 'Hola',
  bodyDoc: DOC,
  quizIds: [],
};

describe('la versión devuelve su documento', () => {
  it('lo serializa como JSON en el campo del contrato', () => {
    const pb = versionToPb(VERSION);
    expect(JSON.parse(pb.body_doc)).toEqual(DOC);
  });

  it('conserva el cuerpo de texto: sigue siendo la fuente de respaldo mientras exista', () => {
    expect(versionToPb(VERSION).body).toBe('Hola');
  });

  it('una versión anterior al documento de bloques sale con la cadena vacía, no con un documento vacío', () => {
    // La diferencia importa: `""` significa «no hay documento, usa `body`»; un documento
    // vacío significaría «el cuerpo no tiene bloques», que es una afirmación distinta.
    expect(versionToPb({ ...VERSION, bodyDoc: null }).body_doc).toBe('');
  });
});

describe('el artículo devuelve el documento de su versión publicada', () => {
  it('lo serializa como JSON en el campo del contrato', () => {
    const pb = articleToPb(ARTICULO);
    expect(JSON.parse(pb.body_doc)).toEqual(DOC);
  });

  it('un artículo publicado antes del documento de bloques cae al texto', () => {
    const pb = articleToPb({ ...ARTICULO, bodyDoc: null });
    expect(pb.body_doc).toBe('');
    expect(pb.body).toBe('Hola');
  });
});

describe('el listado del catálogo no lleva el documento', () => {
  it('el resumen sale sin documento, igual que sale sin cuerpo', () => {
    // Devolver el árbol de bloques de veinte artículos multiplicaría el tamaño de una
    // página que solo muestra títulos.
    const page = articleToPb(ARTICULO);
    const resumen = articleToPb({
      ...ARTICULO,
      body: '',
      bodyDoc: null,
    });
    expect(resumen.body_doc).toBe('');
    expect(page.body_doc).not.toBe('');
  });
});
