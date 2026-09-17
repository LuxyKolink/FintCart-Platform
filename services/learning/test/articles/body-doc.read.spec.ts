/**
 * El documento de bloques en el contrato (T124, reescrita en T135).
 *
 * Esta prueba fijaba el estado de TRANSICIÓN y sus afirmaciones describían un mundo que
 * ya no existe: `body` era la fuente de verdad, el documento podía FALTAR, y por eso había
 * una caída al texto y una «cadena vacía» que significaba «no hay documento, usa `body`».
 * Con T135 la columna `body` se elimina, así que esas afirmaciones no se pueden sostener
 * —el tipo ni siquiera admite un documento nulo— y no se borran sin más: se **sustituyen**
 * por las del estado nuevo. Una prueba que se limita a desaparecer deja el hueco que
 * ocupaba, y el hueco es justo donde alguien volvería a meter una caída al texto.
 *
 * Lo que se fija ahora, que es lo contrario de lo de antes:
 *
 *   - El documento SIEMPRE viaja. No hay respuesta con `body_doc` vacío.
 *   - El texto plano es una **proyección de solo lectura** derivada del documento en la
 *     frontera, no una segunda copia guardada: lo que dice el texto lo dice el documento.
 *   - Un documento vacío y un campo de texto vacío son cosas distintas y siguen
 *     distinguiéndose: el documento vacío es `{"tipo":"doc","contenido":[]}` y el texto
 *     vacío es `''`.
 */
import { articleToPb, catalogToPb, versionToPb } from '../../src/grpc/mapping';
import type { ArticleDetail, ArticleSummary } from '../../src/articles/articles.repository';
import type { VersionRow } from '../../src/publishing/publishing.repository';
import type { BodyDocNode } from '../../src/articles/body-doc';

const DOC: BodyDocNode = {
  tipo: 'doc',
  contenido: [{ tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Hola' }] }],
};

const VACIO: BodyDocNode = { tipo: 'doc', contenido: [] };

/** Un documento con lo que el texto plano NO sabe representar. */
const CON_FORMATO: BodyDocNode = {
  tipo: 'doc',
  contenido: [
    { tipo: 'encabezado', nivel: 2, contenido: [{ tipo: 'texto', texto: 'Cuánto ahorrar' }] },
    {
      tipo: 'parrafo',
      contenido: [
        { tipo: 'texto', texto: 'La regla es ' },
        { tipo: 'texto', texto: 'ahorrar primero', marcas: [{ tipo: 'negrita' }] },
        { tipo: 'texto', texto: '.' },
      ],
    },
    {
      tipo: 'lista',
      contenido: [
        { tipo: 'item_lista', contenido: [{ tipo: 'texto', texto: 'Fijos' }] },
        { tipo: 'item_lista', contenido: [{ tipo: 'texto', texto: 'Variables' }] },
      ],
    },
    { tipo: 'imagen', image_id: 'a'.repeat(64), alt: 'Una gráfica' },
    { tipo: 'calculadora', calculator_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', version: 1 },
  ],
};

const VERSION: VersionRow = {
  versionId: '11111111-1111-4111-8111-111111111111',
  articleId: '22222222-2222-4222-8222-222222222222',
  versionNo: 1,
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
  bodyDoc: DOC,
  quizIds: [],
};

const RESUMEN: ArticleSummary = {
  articleId: '22222222-2222-4222-8222-222222222222',
  title: 'Ahorro',
  category: 'ahorro',
  categoryId: '44444444-4444-4444-8444-444444444444',
  currentVersionNo: 1,
};

describe('la versión devuelve su documento', () => {
  it('lo serializa como JSON en el campo del contrato', () => {
    const pb = versionToPb(VERSION);
    expect(JSON.parse(pb.body_doc)).toEqual(DOC);
  });

  it('el texto plano es una proyección del documento, y dice lo que el documento dice', () => {
    const pb = versionToPb({ ...VERSION, bodyDoc: CON_FORMATO });

    // Las líneas que un lector de texto entiende: un encabezado es una línea, los nodos de
    // texto de un párrafo se concatenan, cada elemento de una lista es una línea, y la
    // imagen y la calculadora no aportan texto.
    expect(pb.body).toBe('Cuánto ahorrar\n\nLa regla es ahorrar primero.\n\nFijos\n\nVariables');
    // La estructura no viaja en el texto: viaja en el documento, que va al lado.
    expect(pb.body).not.toContain('negrita');
    expect(JSON.parse(pb.body_doc)).toEqual(CON_FORMATO);
  });

  it('un documento vacío produce texto vacío, y el documento sigue siendo un documento', () => {
    // La distinción que importaba antes —«no hay documento» frente a «el cuerpo no tiene
    // bloques»— ya no se expresa con la cadena vacía, porque no hay estado «sin
    // documento»: `body_doc` nunca sale vacío, y el documento vacío es una afirmación
    // válida sobre el cuerpo.
    const pb = versionToPb({ ...VERSION, bodyDoc: VACIO });
    expect(pb.body).toBe('');
    expect(JSON.parse(pb.body_doc)).toEqual(VACIO);
  });
});

describe('el artículo devuelve el documento de su versión publicada', () => {
  it('lo serializa como JSON en el campo del contrato', () => {
    const pb = articleToPb(ARTICULO);
    expect(JSON.parse(pb.body_doc)).toEqual(DOC);
    expect(pb.body).toBe('Hola');
  });

  it('el texto sale del documento también cuando el documento tiene estructura', () => {
    const pb = articleToPb({ ...ARTICULO, bodyDoc: CON_FORMATO });
    expect(pb.body).toContain('Cuánto ahorrar');
    expect(pb.body).toContain('Variables');
    // El `alt` de la imagen NO entra en el texto: describe la imagen, no es el cuerpo.
    expect(pb.body).not.toContain('Una gráfica');
  });
});

describe('el listado del catálogo no lleva el documento', () => {
  it('el resumen sale sin documento y sin texto: la página solo muestra títulos', () => {
    // Devolver el árbol de bloques de veinte artículos multiplicaría el tamaño de una
    // página que solo muestra títulos. El resumen es un tipo distinto del detalle, y por
    // eso ni siquiera tiene los campos: no se omite un dato, no existe en esa vista.
    const page = catalogToPb({ items: [RESUMEN], totalSize: 1, nextPageToken: '' });
    expect(page.items).toHaveLength(1);
    // Los campos EXISTEN —la forma del mensaje los exige— y viajan VACÍOS: un resumen no
    // omite el cuerpo, dice que su cuerpo no está en esta vista. La diferencia importa,
    // porque `''` en `body_doc` nunca significa un documento: significa que no lo trae.
    expect(page.items[0]?.body).toBe('');
    expect(page.items[0]?.body_doc).toBe('');
    expect(page.items[0]?.title).toBe('Ahorro');
  });
});
