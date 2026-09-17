/**
 * Migración de los intentos de cuestionario: `20260902110000_quiz_attempts_session_snapshot`
 * (T023, FR-039, FR-041).
 *
 * La tarea original pedía «probar la reescala de calificaciones … verificando que la
 * conversión se aplica». **Esa conversión no existe y no debe existir**: el código de 001 ya
 * calculaba `score` como porcentaje (`earned/total × 100`), así que reescalarlo lo habría
 * doblado. D-18 se corrigió durante la implementación y lo dejó escrito en la cabecera de la
 * propia migración. Una prueba que exigiera la reescala habría pedido que se introdujera el
 * defecto.
 *
 * Lo que se prueba aquí es lo que la migración SÍ hace, que es lo que puede romperse:
 *
 *   1. No toca las notas ya guardadas (ni las multiplica ni las redondea).
 *   2. Acota el rango en la BASE —no solo en el código—, incluido el techo de 100 que antes
 *      no existía: el CHECK anterior solo exigía `>= 0`.
 *   3. Rellena `served_snapshot` en todo intento anterior y lo deja `NOT NULL`, porque un
 *      intento sin lo que se sirvió no es reconstruible años después (FR-016).
 *   4. Revierte sin perder intentos ni notas.
 */
import { BaseDeMigraciones, describeConBaseReal } from '../support/migraciones';

const MIGRACION = '20260902110000_quiz_attempts_session_snapshot.up.sql';

describeConBaseReal('migración de intentos ligados a su sesión (T023)', () => {
  let base: BaseDeMigraciones;
  /** El artículo al que cuelgan los cuestionarios: se siembra UNA vez. */
  let articulo: string;

  // Cada prueba recibe un esquema RECIÉN creado y se lleva el suyo al terminar. Se paga
  // volver a aplicar la cadena en cada una (~1 s) a cambio de que ninguna dependa del
  // orden ni de lo que dejó la anterior: una prueba de migración que solo pasa si se
  // ejecuta detrás de otra no prueba la migración, prueba la secuencia.
  beforeEach(async () => {
    base = await BaseDeMigraciones.crear();
    // Hasta la migración ANTERIOR: así los datos entran en el mundo tal y como era
    // antes de la enmienda y la conversión de verdad se ejecuta sobre ellos.
    await base.aplicarHasta(BaseDeMigraciones.indiceDe('20260902110000') - 1);

    // La categoría NO se siembra aquí: la migración `add_categories` ya dejó las cinco
    // temáticas del mínimo de SC-009, y una sexta 'Ahorro' chocaría con
    // `categories_name_active_uniq`. Se reutiliza la que existe, que además deja ver
    // que el artículo cuelga de una categoría REAL y no de una inventada por la prueba.
    const [categoria] = await base.filas<{ id: string }>(
      'SELECT id FROM categories ORDER BY position, name LIMIT 1',
    );
    const [fila] = await base.filas<{ id: string }>(
      `INSERT INTO articles (title, category_id, author_id)
       VALUES ('Artículo de migración', $1, gen_random_uuid()) RETURNING id`,
      [categoria?.id],
    );
    if (!fila) throw new Error('no se pudo sembrar el artículo');
    articulo = fila.id;
  });

  afterEach(async () => {
    await base.cerrar();
  });

  /**
   * Un cuestionario con dos preguntas, que es lo mínimo para que haya banco.
   *
   * `quizzes.article_id` es `NOT NULL` con FK a `articles`, así que hay que sembrar la
   * cadena entera —categoría, artículo, cuestionario—. No se salta con un artículo de
   * mentira sin categoría: `articles.category_id` es `NOT NULL` desde la migración de
   * categorías, y saltárselo obligaría a desactivar la restricción, que es justo lo
   * que esta prueba tiene que respetar.
   */
  async function sembrarCuestionario(): Promise<string> {
    const [quiz] = await base.filas<{ id: string }>(
      `INSERT INTO quizzes (article_id, title, pass_threshold)
       VALUES ($1, 'Cuestionario de migración ' || gen_random_uuid(), 60) RETURNING id`,
      [articulo],
    );
    if (!quiz) throw new Error('no se pudo sembrar el cuestionario');
    for (const [i, key] of ['a', 'b'].entries()) {
      await base.filas(
        `INSERT INTO questions (quiz_id, position, prompt, options, correct_key, weight)
         VALUES ($1, $2, $3, $4::jsonb, $5, 1)`,
        [quiz.id, i + 1, `Pregunta ${i + 1}`, JSON.stringify({ a: 'Sí', b: 'No' }), key],
      );
    }
    return quiz.id;
  }

  /** Un intento con la forma ANTERIOR: sin `session_id` y sin `served_snapshot`. */
  async function sembrarIntento(quizId: string, nota: string, n = 1): Promise<string> {
    const [intento] = await base.filas<{ id: string }>(
      `INSERT INTO quiz_attempts (user_id, quiz_id, attempt_no, score, answers)
       VALUES (gen_random_uuid(), $1, $2, $3, '{"answers":{}}'::jsonb) RETURNING id`,
      [quizId, n, nota],
    );
    if (!intento) throw new Error('no se pudo sembrar el intento');
    return intento.id;
  }

  it('no reescala las notas que ya eran porcentaje (D-18 corregida)', async () => {
    const quiz = await sembrarCuestionario();
    const notas = ['85.00', '66.67', '0.00', '100.00', '100.00'];
    // Se siembran cinco intentos distintos; `attempt_no` los separa.
    const ids: string[] = [];
    for (const [i, nota] of notas.entries()) {
      ids.push(await sembrarIntento(quiz, nota, i + 1));
    }

    await base.aplicarUna(MIGRACION);

    for (const [i, esperada] of notas.entries()) {
      const fila = await base.fila<{ score: string }>(
        'SELECT score FROM quiz_attempts WHERE id = $1',
        [ids[i]],
      );
      // `NUMERIC(6,2)`: la comparación es contra el valor, no contra su representación.
      expect(Number(fila?.score)).toBe(Number(esperada));
    }
  });

  it('acota el rango en la base: por encima de 100 y por debajo de 0 los rechaza la tabla', async () => {
    const quiz = await sembrarCuestionario();
    // Se aplica primero: el objeto de esta prueba es el CHECK nuevo, que no existe antes.
    await base.aplicarUna(MIGRACION);

    const techo = await base.falla(
      `INSERT INTO quiz_attempts (user_id, quiz_id, attempt_no, score, answers, served_snapshot)
       VALUES (gen_random_uuid(), $1, 90, 100.01, '{}'::jsonb, '[]'::jsonb)`,
      [quiz],
    );
    expect(techo).toMatch(/quiz_attempts_score_range/);

    const suelo = await base.falla(
      `INSERT INTO quiz_attempts (user_id, quiz_id, attempt_no, score, answers, served_snapshot)
       VALUES (gen_random_uuid(), $1, 91, -0.01, '{}'::jsonb, '[]'::jsonb)`,
      [quiz],
    );
    expect(suelo).toMatch(/quiz_attempts_score_range/);

    // Y el valor exacto del borde es válido: un CHECK que rechazara 100 sería peor
    // que no tenerlo, porque la nota perfecta existe.
    await base.filas(
      `INSERT INTO quiz_attempts (user_id, quiz_id, attempt_no, score, answers, served_snapshot)
       VALUES (gen_random_uuid(), $1, 92, 100, '{}'::jsonb, '[]'::jsonb)`,
      [quiz],
    );
  });

  it('un intento sin snapshot servido no es un intento: la columna no admite nulos', async () => {
    const quiz = await sembrarCuestionario();
    await base.aplicarUna(MIGRACION);

    const mensaje = await base.falla(
      `INSERT INTO quiz_attempts (user_id, quiz_id, attempt_no, score, answers)
       VALUES (gen_random_uuid(), $1, 95, 50, '{}'::jsonb)`,
      [quiz],
    );
    expect(mensaje).toMatch(/served_snapshot/);
  });

  it('rellena el snapshot de los intentos anteriores con el banco ACTUAL, y lo deja reconstruible', async () => {
    const quiz = await sembrarCuestionario();
    const intento = await sembrarIntento(quiz, '50.00', 96);

    await base.aplicarUna(MIGRACION);

    const fila = await base.fila<{ served_snapshot: unknown }>(
      'SELECT served_snapshot FROM quiz_attempts WHERE id = $1',
      [intento],
    );
    const snapshot = fila?.served_snapshot as { question_id: string; option_keys: string[] }[];
    expect(Array.isArray(snapshot)).toBe(true);
    // Dos preguntas, cada una con sus dos opciones —el banco de este esquema—.
    expect(snapshot).toHaveLength(2);
    for (const servida of snapshot) {
      expect(servida.question_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(servida.option_keys).toEqual(['a', 'b']);
    }
    // Y lo que de verdad se compra con el snapshot: que el conjunto servido se pueda
    // volver a leer ÍNTEGRO desde el intento, sin depender de que el banco no cambie.
    await base.filas('DELETE FROM questions WHERE quiz_id = $1', [quiz]);
    const reconstruido = await base.fila<{ preguntas: string }>(
      `SELECT count(*)::text AS preguntas FROM jsonb_array_elements(
         (SELECT served_snapshot FROM quiz_attempts WHERE id = $1)
       )`,
      [intento],
    );
    expect(reconstruido?.preguntas).toBe('2');
  });

  it('revierte sin perder intentos ni notas', async () => {
    const quiz = await sembrarCuestionario();
    const intento = await sembrarIntento(quiz, '73.50', 97);
    await base.aplicarUna(MIGRACION);

    await base.revertirUna(MIGRACION);

    const fila = await base.fila<{ score: string }>(
      'SELECT score FROM quiz_attempts WHERE id = $1',
      [intento],
    );
    expect(Number(fila?.score)).toBe(73.5);

    // El techo de 100 desaparece con la migración: es lo que había antes, y una
    // reversión que dejara el CHECK nuevo estaría dejando la mitad de la enmienda.
    await base.filas(
      `INSERT INTO quiz_attempts (user_id, quiz_id, attempt_no, score, answers)
       VALUES (gen_random_uuid(), $1, 98, 150, '{}'::jsonb)`,
      [quiz],
    );

    // Y aquí está la parte que importa de una migración de datos: volver a aplicarla
    // con una fila que el invariante nuevo prohíbe **falla y lo dice**, en lugar de
    // aceptarla o de recortarla en silencio. Recortar una nota al 100 la falsearía; y
    // como `score` era `>= 0` sin techo, una nota de 150 es un dato que la base aceptó
    // durante meses. Que la migración se niegue a inventar un 100 es la respuesta
    // correcta: el dato roto lo tiene que ver una persona.
    const mensaje = await base.falla(() => base.aplicarUna(MIGRACION));
    expect(mensaje).toMatch(/quiz_attempts_score_range/);
  });
});
