/**
 * La migración que elimina `article_versions.body` (T135, D-14, FR-063).
 *
 * Aquí no se comprueba que una columna desaparezca —eso lo dice el catálogo del sistema—,
 * sino las tres cosas que pueden salir mal en el único paso del rediseño que **borra
 * contenido**:
 *
 *   1. Que se borre un texto que el documento NO dice. La migración trae una guarda que lo
 *      comprueba antes de borrar, y esa guarda tiene que NEGARSE y decirlo, no limitarse a
 *      pasar. Se prueba con un texto que discrepa de su documento, que es el caso que la
 *      guarda existe para atrapar.
 *   2. Que el hueco del borrado no se pueda deshacer. La reversión reconstruye el texto
 *      DERIVÁNDOLO del documento, y como toda reconstrucción tiene una regla, la regla se
 *      fija aquí: un párrafo y un encabezado son una línea, cada elemento de una lista es
 *      una línea, y los espacios vuelven normalizados.
 *   3. Que la ida y la vuelta dejen la base donde estaba. Un `up` que se aplica una vez y
 *      no se puede reaplicar tras revertir es un defecto que ya apareció en este proyecto
 *      (hallazgo 23) y del que solo se entera quien lo intenta.
 */
import { BaseDeMigraciones, describeConBaseReal } from '../support/migraciones';

const BORRAR = '20260902150000_drop_article_versions_body.up.sql';
const ANTERIOR = '20260902114500_backfill_body_doc_nulls.up.sql';

const TEXTO = ['Primer párrafo.', '', 'Segundo párrafo, con tildes: crédito e inversión.'].join(
  '\n',
);

/** El documento que dice exactamente lo que dice `TEXTO`. */
const DOC_QUE_LO_DICE = {
  tipo: 'doc',
  contenido: [
    { tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: 'Primer párrafo.' }] },
    {
      tipo: 'parrafo',
      contenido: [{ tipo: 'texto', texto: 'Segundo párrafo, con tildes: crédito e inversión.' }],
    },
  ],
};

/** Escribe un artículo con su versión 1, en el estado ANTERIOR al borrado. */
async function sembrarVersion(
  base: BaseDeMigraciones,
  body: string,
  bodyDoc: object | null,
): Promise<string> {
  const [categoria] = await base.filas<{ id: string }>(
    'SELECT id FROM categories ORDER BY position, name LIMIT 1',
  );
  const [articulo] = await base.filas<{ id: string }>(
    `INSERT INTO articles (title, category_id, author_id)
     VALUES ('Artículo de prueba', $1, gen_random_uuid()) RETURNING id`,
    [categoria?.id],
  );
  const [version] = await base.filas<{ id: string }>(
    `INSERT INTO article_versions (article_id, version_no, body, body_doc, created_by)
     VALUES ($1, 1, $2, $3::jsonb, gen_random_uuid()) RETURNING id`,
    [articulo?.id, body, bodyDoc === null ? null : JSON.stringify(bodyDoc)],
  );
  if (!version) throw new Error('no se pudo sembrar la versión');
  return version.id;
}

describeConBaseReal('la migración que elimina `body` (T135)', () => {
  let base: BaseDeMigraciones;

  beforeEach(async () => {
    base = await BaseDeMigraciones.crear();
    await base.aplicarHasta(BaseDeMigraciones.indiceDe(ANTERIOR));
  });

  afterEach(async () => {
    await base.cerrar();
  });

  it('borra la columna y deja el documento como única fuente', async () => {
    await sembrarVersion(base, TEXTO, DOC_QUE_LO_DICE);

    await base.aplicarUna(BORRAR);

    // `table_schema = current_schema()`: sin ese filtro, `information_schema` devuelve las
    // columnas de TODAS las tablas con ese nombre —la de `public` incluida— y la prueba
    // mediría la base entera en lugar del esquema que acaba de migrar.
    const columnas = await base.filas<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'article_versions' AND column_name IN ('body', 'body_doc')`,
    );
    expect(columnas.map((c) => c.column_name)).toEqual(['body_doc']);
    expect(columnas[0]?.is_nullable).toBe('NO');
  });

  it('el CHECK de la raíz deja de admitir un documento nulo', async () => {
    // El nulo era admisible mientras el nulo era posible. Un CHECK que permite un estado
    // que la columna ya prohíbe se lee como una invitación a escribir el nulo.
    await base.aplicarUna(BORRAR);

    const [restriccion] = await base.filas<{ definicion: string }>(
      `SELECT pg_get_constraintdef(oid) AS definicion FROM pg_constraint
        WHERE conname = 'article_versions_body_doc_root'
          AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())`,
    );
    expect(restriccion?.definicion).not.toContain('IS NULL');
    expect(restriccion?.definicion).toContain("'doc'");
  });

  it('un documento nulo ya no se puede guardar', async () => {
    await base.aplicarUna(BORRAR);
    const [categoria] = await base.filas<{ id: string }>(
      'SELECT id FROM categories ORDER BY position, name LIMIT 1',
    );
    const [articulo] = await base.filas<{ id: string }>(
      `INSERT INTO articles (title, category_id, author_id)
       VALUES ('Artículo sin cuerpo', $1, gen_random_uuid()) RETURNING id`,
      [categoria?.id],
    );

    const mensaje = await base.falla(
      `INSERT INTO article_versions (article_id, version_no, body_doc, created_by)
       VALUES ($1, 1, NULL, gen_random_uuid())`,
      [articulo?.id],
    );
    expect(mensaje).toMatch(/body_doc/u);
  });

  it('SE NIEGA a borrar si el texto dice algo que el documento no dice', async () => {
    // El caso que la guarda existe para atrapar: borrar aquí perdería texto, y la
    // reversión NO lo traería de vuelta —reconstruye desde el documento—, así que la
    // única salida honrada es negarse y decir cuál es la versión que discrepa.
    await sembrarVersion(base, 'Un texto que su documento no dice.', DOC_QUE_LO_DICE);

    const mensaje = await base.falla(() => base.aplicarUna(BORRAR));

    expect(mensaje).toMatch(/perdería ese texto/u);
    // Y no dejó la migración a medias: la columna sigue, porque la transacción se deshizo.
    const [columna] = await base.filas<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'article_versions' AND column_name = 'body'`,
    );
    expect(columna?.column_name).toBe('body');
  });

  it('SE NIEGA a borrar si alguna versión no tiene documento', async () => {
    await sembrarVersion(base, TEXTO, null);

    const mensaje = await base.falla(() => base.aplicarUna(BORRAR));

    expect(mensaje).toMatch(/sin documento/u);
  });

  it('la ida y la vuelta conservan el texto, y la reversión lo reconstruye del documento', async () => {
    const id = await sembrarVersion(base, TEXTO, DOC_QUE_LO_DICE);

    await base.aplicarUna(BORRAR);
    await base.revertirUna(BORRAR);

    const [fila] = await base.filas<{ body: string; admite_nulo: string }>(
      `SELECT v.body,
              (SELECT is_nullable FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'article_versions' AND column_name = 'body_doc') AS admite_nulo
         FROM article_versions v WHERE v.id = $1`,
      [id],
    );
    // El texto vuelve reconstruido, sin los espacios que la conversión de ida ya había
    // perdido: es la misma comparación que hace la guarda del `up`, sin espacios.
    expect((fila?.body ?? '').replace(/\s/gu, '')).toBe(TEXTO.replace(/\s/gu, ''));
    // Y `body_doc` vuelve a admitir nulos, porque revertir deja la base como estaba y no
    // como a esta migración le habría gustado que estuviera.
    expect(fila?.admite_nulo).toBe('YES');
  });

  it('la reversión aplana una lista con una línea por elemento', async () => {
    // La regla de reconstrucción tiene que estar fijada: no es la misma que la del `up`
    // —aquel solo compara, esta tiene que producir texto— y sin una prueba que la fije,
    // cualquier reescritura futura la cambiaría sin que nadie lo notara.
    const doc = {
      tipo: 'doc',
      contenido: [
        { tipo: 'encabezado', nivel: 2, contenido: [{ tipo: 'texto', texto: 'Tres bloques' }] },
        {
          tipo: 'lista',
          contenido: [
            { tipo: 'item_lista', contenido: [{ tipo: 'texto', texto: 'Fijos' }] },
            { tipo: 'item_lista', contenido: [{ tipo: 'texto', texto: 'Variables' }] },
          ],
        },
      ],
    };
    const id = await sembrarVersion(
      base,
      'Tres bloques\n\nFijos\n\nVariables',
      doc,
    );

    await base.aplicarUna(BORRAR);
    await base.revertirUna(BORRAR);

    const [fila] = await base.filas<{ body: string }>(
      'SELECT body FROM article_versions WHERE id = $1',
      [id],
    );
    expect(fila?.body).toBe('Tres bloques\n\nFijos\n\nVariables');
  });

  it('la ida y la vuelta se pueden repetir: revertir no deja la migración sin poder reaplicarse', async () => {
    // Es el defecto del hallazgo 23, buscado a propósito esta vez: revertir y volver a
    // aplicar es el camino de recuperación normal de `golang-migrate`.
    await sembrarVersion(base, TEXTO, DOC_QUE_LO_DICE);

    await base.aplicarUna(BORRAR);
    await base.revertirUna(BORRAR);
    await base.aplicarUna(BORRAR);

    const [columna] = await base.filas<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'article_versions' AND column_name = 'body'`,
    );
    expect(columna).toBeUndefined();
  });
});
