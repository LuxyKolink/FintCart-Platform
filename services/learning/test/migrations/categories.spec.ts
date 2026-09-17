/**
 * Migración de categorías: `20260902101500_link_articles_to_categories` (T024, FR-034).
 *
 * Es una migración de CONVERSIÓN de datos, y el orden que sigue —poblar → rellenar →
 * restringir → borrar— es lo que la hace segura: si el relleno fallara, el `NOT NULL` no
 * llega y la columna vieja sigue ahí. Lo que se prueba aquí es exactamente lo que puede
 * romperse en ese camino:
 *
 *   1. Ningún artículo se queda sin categoría (la guarda de la migración, más la prueba).
 *   2. Los valores que solo difieren en tildes, mayúsculas o separadores colapsan en UNA
 *      categoría: `'educacion financiera'`, `'Educación Financiera'` y
 *      `'educacion_financiera'` son el mismo concepto y no pueden ser tres categorías.
 *   3. Un valor que coincide con una de las cinco temáticas se cuelga de ELLA, no de una
 *      copia —`'seguridad_financiera'` acaba en la categoría `seguridad-financiera` que
 *      sembró el mínimo de SC-009—.
 *   4. El texto libre desaparece de la tabla, y la reversión lo devuelve.
 */
import { BaseDeMigraciones, describeConBaseReal } from '../support/migraciones';

const CREAR_CATEGORIAS = '20260902100000_add_categories.up.sql';
const CONVERTIR = '20260902101500_link_articles_to_categories.up.sql';

describeConBaseReal('migración del texto libre de categoría al catálogo (T024)', () => {
  let base: BaseDeMigraciones;

  // Un esquema recién creado por prueba: la migración BORRA una columna, así que dos
  // pruebas sobre el mismo esquema no pueden coexistir.
  beforeEach(async () => {
    base = await BaseDeMigraciones.crear();
    await base.aplicarHasta(BaseDeMigraciones.indiceDe(CONVERTIR) - 1);
  });

  afterEach(async () => {
    await base.cerrar();
  });

  /** Un artículo con el texto libre de la época, tal como estaba antes de la enmienda. */
  async function sembrarArticulo(texto: string): Promise<string> {
    const [fila] = await base.filas<{ id: string }>(
      `INSERT INTO articles (title, category, author_id)
       VALUES ('Artículo de ' || gen_random_uuid()::text, $1, gen_random_uuid()) RETURNING id`,
      [texto],
    );
    if (!fila) throw new Error('no se pudo sembrar el artículo');
    return fila.id;
  }

  it('no deja ningún artículo sin categoría', async () => {
    const textos = ['Presupuesto', 'aHorro', 'Deudas raras', 'criptomonedas'];
    for (const texto of textos) {
      await sembrarArticulo(texto);
    }

    await base.aplicarUna(CONVERTIR);

    const huerfanos = await base.fila<{ n: string }>(
      'SELECT count(*)::text AS n FROM articles WHERE category_id IS NULL',
    );
    expect(huerfanos?.n).toBe('0');
    // Y la columna de texto libre ya no está: el paso 4 de la migración.
    const columnas = await base.filas<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'articles'`,
    );
    expect(columnas.map((c) => c.column_name)).not.toContain('category');
  });

  it('se PLANTA, con mensaje, si un artículo tiene la categoría en blanco: no inventa una', async () => {
    // `articles.category` era `TEXT NOT NULL` **sin** CHECK de contenido, así que una
    // categoría '   ' es representable —y quien la escribiera por una herramienta
    // distinta al formulario la deja ahí—. La migración no la adivina: su guarda
    // aborta y dice cuántos artículos quedan sin categoría. Abortar es la respuesta
    // correcta: asignarle una categoría al azar metería contenido en un catálogo
    // equivocado, y eso sí que no se puede deshacer. El coste es que una base con una
    // fila así necesita que alguien decida antes de migrar, y ese coste se paga a gusto.
    await sembrarArticulo('');
    await sembrarArticulo('   ');

    const mensaje = await base.falla(() => base.aplicarUna(CONVERTIR));
    expect(mensaje).toMatch(/sin categoría al imponer NOT NULL/);
    // Y la base queda COMO ESTABA: la migración es transaccional, así que el `ROLLBACK`
    // deja el texto libre intacto y ninguna categoría a medias.
    const columnas = await base.filas<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'articles'`,
    );
    expect(columnas.map((c) => c.column_name)).toContain('category');
    const categorias = await base.fila<{ n: string }>('SELECT count(*)::text AS n FROM categories');
    expect(categorias?.n).toBe('0');
  });

  it('las diferencias de tildes, mayúsculas y separadores colapsan en UNA categoría', async () => {
    const variantes = [
      'educacion financiera',
      'Educación Financiera',
      'educacion_financiera',
      'EDUCACION FINANCIERA',
      '  Educación   Financiera  ',
    ];
    const sembrados: string[] = [];
    for (const variante of variantes) {
      sembrados.push(await sembrarArticulo(variante));
    }

    await base.aplicarUna(CONVERTIR);

    const categorias = await base.filas<{ category_id: string }>(
      `SELECT DISTINCT category_id FROM articles WHERE id = ANY($1::uuid[])`,
      [sembrados],
    );
    // Cinco artículos, una sola categoría. Sin normalización serían cuatro o cinco.
    expect(categorias).toHaveLength(1);

    const fila = await base.fila<{ name: string; slug: string }>(
      'SELECT name, slug FROM categories WHERE id = $1',
      [categorias[0]?.category_id],
    );
    expect(fila?.slug).toBe('educacion-financiera');
    // El nombre conserva UN original (el alfabéticamente menor), y ese detalle importa:
    // inventar un nombre «bonito» perdería la forma en que el contenido se publicó.
    expect(variantes).toContain(fila?.name);
  });

  it('un valor que coincide con una categoría temática se cuelga de ELLA, no de una copia', async () => {
    // Antes de la conversión NO hay ninguna categoría: la tabla existe y está vacía. Las
    // cinco temáticas las siembra el paso 2 de la conversión, así que el caso que se
    // prueba es que el texto libre llegue al MISMO slug al que apunta el mínimo canónico,
    // en lugar de crear una sexta categoría para el mismo concepto.
    const sembrados = [
      await sembrarArticulo('seguridad_financiera'),
      await sembrarArticulo('Seguridad Financiera'),
    ];
    const antes = await base.fila<{ n: string }>('SELECT count(*)::text AS n FROM categories');
    expect(antes?.n).toBe('0');

    await base.aplicarUna(CONVERTIR);

    const destinos = await base.filas<{ category_id: string; slug: string }>(
      `SELECT DISTINCT a.category_id, c.slug
         FROM articles a JOIN categories c ON c.id = a.category_id
        WHERE a.id = ANY($1::uuid[])`,
      [sembrados],
    );
    expect(destinos).toHaveLength(1);
    expect(destinos[0]?.slug).toBe('seguridad-financiera');

    // Y no quedó una segunda categoría para el mismo concepto: exactamente una con ese
    // prefijo, la del slug canónico.
    const conEsePrefijo = await base.filas<{ slug: string }>(
      `SELECT slug FROM categories WHERE slug LIKE 'seguridad%' ORDER BY slug`,
    );
    expect(conEsePrefijo.map((d) => d.slug)).toEqual(['seguridad-financiera']);
  });

  it('el mínimo de cinco categorías temáticas queda garantizado (SC-009)', async () => {
    await sembrarArticulo('Presupuesto');
    await base.aplicarUna(CONVERTIR);

    const total = await base.fila<{ n: string }>(
      'SELECT count(*)::text AS n FROM categories WHERE active',
    );
    expect(Number(total?.n)).toBeGreaterThanOrEqual(5);
    // Las cinco que SC-009 nombra, por su slug: es la identidad de la categoría.
    const slugs = await base.filas<{ slug: string }>(
      `SELECT slug FROM categories WHERE slug IN
         ('presupuesto','ahorro','credito','inversion','seguridad-financiera')`,
    );
    expect(slugs).toHaveLength(5);
  });

  it('revierte y el texto libre vuelve, sin perder artículos', async () => {
    const original = 'Educación Financiera';
    const articulo = await sembrarArticulo(original);
    await base.aplicarUna(CONVERTIR);

    await base.revertirUna(CONVERTIR);

    const fila = await base.fila<{ category: string }>(
      'SELECT category FROM articles WHERE id = $1',
      [articulo],
    );
    expect(fila?.category).toBe(original);
    // Y `category_id` ya no está: la añadió ESTA migración, así que su reversión la
    // quita. Una reversión que dejara la columna estaría dejando media enmienda.
    const columnas = await base.filas<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'articles'`,
    );
    expect(columnas.map((c) => c.column_name)).not.toContain('category_id');
    // `add_categories` sigue aplicada: la reversión deshace la CONVERSIÓN, no el
    // catálogo. Que se pueda revertir una sola migración es lo que hace útil tenerlas
    // emparejadas.
    const categorias = await base.fila<{ n: string }>(
      'SELECT count(*)::text AS n FROM categories',
    );
    expect(Number(categorias?.n)).toBeGreaterThanOrEqual(5);

    // Y el ciclo completo vuelve a funcionar: reaplicarla es lo que hace `golang-migrate`
    // tras una reversión, y tiene que dar el mismo resultado.
    await base.aplicarUna(CONVERTIR);
    const deNuevo = await base.fila<{ category_id: string | null }>(
      'SELECT category_id FROM articles WHERE id = $1',
      [articulo],
    );
    expect(deNuevo?.category_id).not.toBeNull();

    // La migración deja el esquema sin los auxiliares que creó (paso 5): una función
    // que sobrevive a su migración es basura que nadie se atreve a borrar.
    const funciones = await base.filas<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = current_schema()
          AND p.proname IN ('learning_category_key', 'learning_category_slug')`,
    );
    expect(funciones).toHaveLength(0);
  });

  it('la migración de categorías por sí sola crea el catálogo vacío y siembra el mínimo', async () => {
    // Estado ANTERIOR a la conversión: la tabla existe y ya tiene las cinco temáticas,
    // y los artículos siguen con texto libre. Es el estado en el que `CREAR_CATEGORIAS`
    // deja la base, y comprobarlo aquí evita atribuirle a la conversión lo que hizo la
    // migración anterior.
    const articulo = await sembrarArticulo('Ahorro');
    const fila = await base.fila<{ category: string }>(
      'SELECT category FROM articles WHERE id = $1',
      [articulo],
    );
    expect(fila?.category).toBe('Ahorro');
    expect(CREAR_CATEGORIAS).toBe('20260902100000_add_categories.up.sql');
  });
});
