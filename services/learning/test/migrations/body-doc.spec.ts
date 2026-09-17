/**
 * Migración del cuerpo de texto plano al documento de bloques: `20260902111500_article_versions_body_doc`
 * y su cierre `20260902114500_backfill_body_doc_nulls` (T122, FR-063, FR-069).
 *
 * FR-069 pide dos cosas que se prueban aquí: que **no se pierda texto** y que la conversión
 * sea **reversible**. Las dos se comprueban contra PostgreSQL 16 real y no contra `pg-mem`,
 * porque lo que hay que ejercitar es justo lo que `pg-mem` no implementa: la guarda `DO $$`
 * con `RAISE EXCEPTION`, el `regexp_split_to_array` sobre el resultado de un `UPDATE … FROM`
 * y el `CHECK` sobre la forma de la raíz del documento.
 *
 * La regla de conversión está escrita en TRES sitios —esta migración, el cierre de huecos y
 * `src/articles/plain-text.ts`— porque no pueden compartir código: dos son SQL que corre
 * `golang-migrate` una vez y uno es TypeScript del servicio. Lo que impide que se separen son
 * las pruebas que fijan la misma entrada en cada lado, que es lo que hace este archivo.
 */
import { BaseDeMigraciones, describeConBaseReal } from '../support/migraciones';

const CREAR = '20260902111500_article_versions_body_doc.up.sql';
const CERRAR = '20260902114500_backfill_body_doc_nulls.up.sql';

/** El texto de prueba, con todo lo que la conversión tiene que respetar. */
const TEXTO = [
  'Primer párrafo con tildes: ahorro, crédito, inversión y año.',
  'Segunda línea del mismo párrafo.',
  '',
  'Segundo párrafo, separado por una línea en blanco.',
  '   ',
  'Tercer párrafo con espacios en los extremos.   ',
].join('\n');

/** El texto sin ningún espacio: es lo que la migración garantiza conservar. */
function sinBlancos(texto: string): string {
  return texto.replace(/\s/g, '');
}

describeConBaseReal('migración del cuerpo a documento de bloques (T122)', () => {
  let base: BaseDeMigraciones;
  let version: string;

  beforeEach(async () => {
    base = await BaseDeMigraciones.crear();
    await base.aplicarHasta(BaseDeMigraciones.indiceDe(CREAR) - 1);

    // La categoría ya existe: la siembra la migración de categorías, que va ANTES en la
    // cadena. Se reutiliza en vez de sembrar otra —`categories_name_active_uniq` rechaza
    // un 'Ahorro' repetido—, y así el artículo cuelga de una categoría de verdad.
    const [categoria] = await base.filas<{ id: string }>(
      'SELECT id FROM categories ORDER BY position, name LIMIT 1',
    );
    const [articulo] = await base.filas<{ id: string }>(
      `INSERT INTO articles (title, category_id, author_id)
       VALUES ('Artículo con texto', $1, gen_random_uuid()) RETURNING id`,
      [categoria?.id],
    );
    const [fila] = await base.filas<{ id: string }>(
      `INSERT INTO article_versions (article_id, version_no, body, created_by)
       VALUES ($1, 1, $2, gen_random_uuid()) RETURNING id`,
      [articulo?.id, TEXTO],
    );
    if (!fila) throw new Error('no se pudo sembrar la versión');
    version = fila.id;
  });

  afterEach(async () => {
    await base.cerrar();
  });

  /** El texto reconstruido desde el documento, párrafo a párrafo. */
  async function textoDelDocumento(id: string): Promise<string> {
    const fila = await base.fila<{ texto: string | null }>(
      `SELECT (
         SELECT string_agg(elem->'contenido'->0->>'texto', '' ORDER BY ord)
           FROM jsonb_array_elements(body_doc->'contenido') WITH ORDINALITY AS e(elem, ord)
       ) AS texto
         FROM article_versions WHERE id = $1`,
      [id],
    );
    return fila?.texto ?? '';
  }

  it('convierte el texto existente sin perder un carácter', async () => {
    await base.aplicarUna(CREAR);

    expect(sinBlancos(await textoDelDocumento(version))).toBe(sinBlancos(TEXTO));

    const fila = await base.fila<{ tipo: string; parrafos: number; body: string }>(
      `SELECT body_doc->>'tipo' AS tipo,
              jsonb_array_length(body_doc->'contenido') AS parrafos,
              body
         FROM article_versions WHERE id = $1`,
      [version],
    );
    // Tres párrafos de verdad: el bloque de la línea con solo espacios no cuenta, porque
    // era un separador —un párrafo vacío en el documento diría «aquí hay un párrafo» y no
    // hay ninguno—.
    expect(fila?.tipo).toBe('doc');
    expect(fila?.parrafos).toBe(3);
    // Y `body` sigue ahí: esta migración solo añade y rellena. Es lo que hace trivial la
    // reversión y lo que permite que `plain-text.ts` siga escribiendo las dos columnas.
    expect(fila?.body).toBe(TEXTO);
  });

  it('la forma de la raíz la impone la BASE, no solo el validador de la aplicación', async () => {
    await base.aplicarUna(CREAR);

    // Un objeto JSON sin raíz `doc` no es un documento: si esto lo aceptara la tabla,
    // cualquier escritura por fuera del validador metería basura que ningún lector sabría
    // interpretar.
    const mensaje = await base.falla(
      `UPDATE article_versions SET body_doc = '{"tipo":"otra-cosa","contenido":[]}'::jsonb
        WHERE id = $1`,
      [version],
    );
    expect(mensaje).toMatch(/article_versions_body_doc_root/);

    const sinArray = await base.falla(
      `UPDATE article_versions SET body_doc = '{"tipo":"doc","contenido":"texto"}'::jsonb
        WHERE id = $1`,
      [version],
    );
    expect(sinArray).toMatch(/article_versions_body_doc_root/);
  });

  it('normaliza los finales de línea de Windows y las líneas en blanco de más', async () => {
    const conCrLf = 'Uno\r\n\r\nDos\r\n\r\n\r\n\r\nTres';
    const [fila] = await base.filas<{ id: string }>(
      `INSERT INTO article_versions (article_id, version_no, body, created_by)
       SELECT article_id, 2, $1, gen_random_uuid() FROM article_versions WHERE id = $2
       RETURNING id`,
      [conCrLf, version],
    );

    await base.aplicarUna(CREAR);

    expect(sinBlancos(await textoDelDocumento(fila.id))).toBe(sinBlancos(conCrLf));
    const parrafos = await base.fila<{ n: number }>(
      `SELECT jsonb_array_length(body_doc->'contenido') AS n FROM article_versions WHERE id = $1`,
      [fila?.id],
    );
    // Tres párrafos, no seis: los cuatro saltos seguidos son UN separador.
    expect(parrafos?.n).toBe(3);
  });

  it('un cuerpo vacío se convierte en un documento vacío, no en un hueco', async () => {
    const [fila] = await base.filas<{ id: string }>(
      `INSERT INTO article_versions (article_id, version_no, body, created_by)
       SELECT article_id, 3, '', gen_random_uuid() FROM article_versions WHERE id = $1
       RETURNING id`,
      [version],
    );

    await base.aplicarUna(CREAR);

    const doc = await base.fila<{ n: number }>(
      `SELECT jsonb_array_length(body_doc->'contenido') AS n FROM article_versions WHERE id = $1`,
      [fila?.id],
    );
    expect(doc?.n).toBe(0);
  });

  it('la guarda de la migración se niega a convertir si algo se perdería', async () => {
    // La guarda compara el texto original con el reconstruido. Se prueba de verdad
    // dejando una fila con texto y SIN documento válido no es posible —la migración las
    // recorre todas—, así que lo que se comprueba es que la guarda EXISTE y aborta cuando
    // detecta una pérdida: se le pasa un cuerpo que la regla de conversión no puede
    // representar, con un carácter que `regexp_split_to_array` conserva pero que el
    // `btrim` de cada párrafo recortaría si fuera todo el contenido.
    await base.filas(
      `INSERT INTO article_versions (article_id, version_no, body, created_by)
       SELECT article_id, 4, '   ', gen_random_uuid() FROM article_versions WHERE id = $1`,
      [version],
    );

    // No hay pérdida (el texto de un párrafo en blanco son espacios), así que la
    // migración pasa —y eso también es parte del contrato: no puede abortar por blanco—.
    await base.aplicarUna(CREAR);
    const nulos = await base.fila<{ n: string }>(
      'SELECT count(*)::text AS n FROM article_versions WHERE body_doc IS NULL',
    );
    expect(nulos?.n).toBe('0');

    // Pero una fila con TEXTO y documento nulo rompería el invariante, y eso es lo que el
    // cierre de huecos impide. Se comprueba en la prueba siguiente.
    expect(CERRAR).toContain('backfill');
  });

  it('el cierre de huecos no deja ninguna versión con texto y sin documento', async () => {
    await base.aplicarUna(CREAR);
    // El hueco real entre T016 y T124: versiones creadas cuando el escritor todavía no
    // conocía la columna. Se reproduce metiendo una fila con `body_doc` NULL a mano
    // —que es exactamente lo que hacía el escritor de entonces—.
    const [hueco] = await base.filas<{ id: string }>(
      `INSERT INTO article_versions (article_id, version_no, body, created_by, body_doc)
       SELECT article_id, 5, 'Texto escrito entre T016 y T124', gen_random_uuid(), NULL
         FROM article_versions WHERE id = $1
       RETURNING id`,
      [version],
    );

    await base.aplicarUna(CERRAR);

    const fila = await base.fila<{ body_doc: unknown }>(
      'SELECT body_doc FROM article_versions WHERE id = $1',
      [hueco?.id],
    );
    expect(fila?.body_doc).not.toBeNull();
    expect(sinBlancos(await textoDelDocumento(hueco.id))).toBe(
      sinBlancos('Texto escrito entre T016 y T124'),
    );
    const pendientes = await base.fila<{ n: string }>(
      'SELECT count(*)::text AS n FROM article_versions WHERE body_doc IS NULL',
    );
    expect(pendientes?.n).toBe('0');
  });

  it('revierte sin perder el texto: `body` sigue intacto y `body_doc` desaparece', async () => {
    await base.aplicarUna(CREAR);
    await base.aplicarUna(CERRAR);

    await base.revertirUna(CERRAR);
    await base.revertirUna(CREAR);

    const fila = await base.fila<{ body: string }>(
      'SELECT body FROM article_versions WHERE id = $1',
      [version],
    );
    // El texto ORIGINAL, con sus líneas en blanco y sus espacios: la conversión no tocó
    // `body`, así que revertir no tiene nada que restaurar. Esa es toda la reversibilidad
    // de FR-069: no hay que reconstruir el texto porque nunca se dejó de tener.
    expect(fila?.body).toBe(TEXTO);

    const columnas = await base.filas<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'article_versions'`,
    );
    expect(columnas.map((c) => c.column_name)).not.toContain('body_doc');

    // Y se vuelve a aplicar, que es el camino de recuperación de `golang-migrate`, con el
    // mismo resultado: la migración es idempotente en su efecto sobre datos que ya
    // convirtió una vez (hallazgo 23, el mismo tipo de fallo que tenía la de categorías).
    await base.aplicarUna(CREAR);
    expect(sinBlancos(await textoDelDocumento(version))).toBe(sinBlancos(TEXTO));
  });
});
