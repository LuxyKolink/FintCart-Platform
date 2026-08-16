/**
 * Pruebas de la capa de persistencia de Aprendizaje (T082, §Calidad).
 *
 * Corren contra `pg-mem`, un PostgreSQL en memoria que EJECUTA el SQL de verdad. La
 * alternativa —un doble del driver que devuelve filas preparadas— comprobaría que se
 * llamó a `query` con cierta cadena, que es justo lo que no importa: lo que puede
 * romperse aquí es el propio SQL, y un doble lo daría siempre por bueno.
 *
 * Lo que se fija:
 *
 * - El catálogo NO expone borradores. Es la prueba más importante del archivo: un
 *   filtro `state = 'publicado'` que se pierda en un refactor publica contenido sin
 *   revisar bajo la marca (FR-008), y ninguna otra capa lo comprobaría.
 * - `attempt_no` se calcula solo y crece de uno en uno (FR-016).
 * - Las calificaciones cruzan como `Decimal` exacto, nunca como `number`
 *   (Principio VIII).
 * - Los agregados de `article_stats` se RECALCULAN, así que un promedio no deriva.
 */
import Decimal from 'decimal.js';
import type { Pool } from 'pg';

import { ArticlesRepository } from '../src/articles/articles.repository';
import { QuizzesRepository } from '../src/quizzes/quizzes.repository';

import { IDS, newMemoryFixture } from './support/memdb';

/** Repositorios cableados sobre una base en memoria recién creada. */
function newFixture(): { pool: Pool; articles: ArticlesRepository; quizzes: QuizzesRepository } {
  const { pool } = newMemoryFixture();
  return {
    pool,
    articles: new ArticlesRepository(pool),
    quizzes: new QuizzesRepository(pool),
  };
}

// ── catálogo ───────────────────────────────────────────────────────────────

describe('ArticlesRepository', () => {
  it('el catálogo publicado NO incluye borradores', async () => {
    const { articles } = newFixture();

    const page = await articles.listPublished('', { limit: 20, offset: 0 });

    // Un borrador filtrado por error no es un fallo cosmético: es contenido sin
    // revisar publicado bajo la marca (FR-008).
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.articleId).toBe(IDS.article);
    expect(page.total).toBe(1);
  });

  it('filtra por categoría y la categoría vacía significa todas', async () => {
    const { articles } = newFixture();

    const ahorro = await articles.listPublished('ahorro', { limit: 20, offset: 0 });
    const inversion = await articles.listPublished('inversion', { limit: 20, offset: 0 });

    expect(ahorro.items).toHaveLength(1);
    expect(inversion.items).toHaveLength(0);
  });

  it('leer un artículo devuelve su cuerpo, sus cuestionarios y cuenta la vista', async () => {
    const { articles, pool } = newFixture();

    const article = await articles.findPublishedAndRecordView(IDS.article);

    expect(article?.body).toBe('Cuerpo publicado');
    expect(article?.currentVersionNo).toBe(3);
    expect(article?.quizIds).toEqual([IDS.quiz]);

    const stats = await pool.query<{ view_count: string }>(
      'SELECT view_count FROM article_stats WHERE article_id = $1',
      [IDS.article],
    );
    expect(Number(stats.rows[0]?.view_count)).toBe(1);
  });

  it('la vista se acumula en lecturas sucesivas', async () => {
    const { articles, pool } = newFixture();

    await articles.findPublishedAndRecordView(IDS.article);
    await articles.findPublishedAndRecordView(IDS.article);

    // El `ON CONFLICT DO UPDATE` es lo que permite que la primera lectura cree la fila
    // y las siguientes la incrementen sin una consulta previa.
    const stats = await pool.query<{ view_count: string }>(
      'SELECT view_count FROM article_stats WHERE article_id = $1',
      [IDS.article],
    );
    expect(Number(stats.rows[0]?.view_count)).toBe(2);
  });

  it('un artículo en borrador no se puede leer por id', async () => {
    const { articles } = newFixture();

    // `null` y no un error distinto: para el lector, «no existe» y «existe pero no
    // está publicado» tienen que ser indistinguibles, o la respuesta delataría la
    // existencia de borradores.
    expect(await articles.findPublishedAndRecordView(IDS.draftArticle)).toBeNull();
  });
});

// ── cuestionarios e intentos ───────────────────────────────────────────────

describe('QuizzesRepository', () => {
  it('el cuestionario servido NO contiene las respuestas correctas', async () => {
    const { quizzes } = newFixture();

    const quiz = await quizzes.findQuiz(IDS.quiz);

    expect(quiz?.questions).toHaveLength(2);
    // Se comprueba sobre el objeto SERIALIZADO: un campo añadido por descuido en el
    // futuro aparecería aquí aunque el tipo no lo declare.
    expect(JSON.stringify(quiz)).not.toContain('correct_key');
    expect(JSON.stringify(quiz)).not.toContain('correctKey');
  });

  it('las opciones llevan su clave y salen en orden estable', async () => {
    const { quizzes } = newFixture();

    const quiz = await quizzes.findQuiz(IDS.quiz);

    // Sin la clave, `GradeRequest.answers` —que mapea `question_id -> option_key`— no
    // se podría construir y el cuestionario sería incontestable.
    expect(quiz?.questions[0]?.options).toEqual([
      { key: 'a', text: 'Un ahorro para imprevistos' },
      { key: 'b', text: 'Una inversión de riesgo' },
    ]);
  });

  it('los pesos y el umbral llegan como Decimal exacto', async () => {
    const { quizzes } = newFixture();

    const quiz = await quizzes.findQuiz(IDS.quiz);

    expect(quiz?.passThreshold.equals(new Decimal('70'))).toBe(true);
    expect(quiz?.questions[1]?.weight.equals(new Decimal('3'))).toBe(true);
  });

  it('la clave de corrección se lee por separado', async () => {
    const { quizzes } = newFixture();

    const key = await quizzes.findGradingKey(IDS.quiz);

    expect(key?.answers.get(IDS.questionA)?.correctKey).toBe('a');
    expect(key?.answers.get(IDS.questionB)?.correctKey).toBe('b');
    expect(key?.articleId).toBe(IDS.article);
  });

  it('attempt_no empieza en 1 y crece de uno en uno', async () => {
    const { quizzes } = newFixture();

    const first = await quizzes.storeAttempt(IDS.user, IDS.quiz, IDS.article, '50.00', {
      [IDS.questionA]: 'a',
    });
    const second = await quizzes.storeAttempt(IDS.user, IDS.quiz, IDS.article, '100.00', {
      [IDS.questionA]: 'a',
      [IDS.questionB]: 'b',
    });

    expect(first.attemptNo).toBe(1);
    expect(second.attemptNo).toBe(2);
  });

  // T176 (SC-008, FR-016): reproduce el reintento del motor de sagas del
  // Orquestador —`GradeAndStoreAttempt` tuvo éxito, pero el avance no llegó a
  // confirmarse, así que el paso se repite con la MISMA clave (`saga_id`).
  it('repetir la misma clave de idempotencia devuelve el intento existente, no crea uno nuevo', async () => {
    const { quizzes } = newFixture();

    const first = await quizzes.storeAttempt(
      IDS.user,
      IDS.quiz,
      IDS.article,
      '50.00',
      { [IDS.questionA]: 'a' },
      'saga-77',
    );
    const second = await quizzes.storeAttempt(
      IDS.user,
      IDS.quiz,
      IDS.article,
      '50.00',
      { [IDS.questionA]: 'a' },
      'saga-77',
    );

    expect(second.attemptId).toBe(first.attemptId);
    expect(second.attemptNo).toBe(first.attemptNo);

    const page = await quizzes.listAttempts(IDS.user, IDS.quiz, { limit: 20, offset: 0 });
    expect(page.total).toBe(1);
  });

  // Y el contraste: sin clave, dos llamadas siguen siendo dos intentos — el
  // comportamiento de antes de T176 para quien no reintenta una saga.
  it('sin clave de idempotencia, dos llamadas siguen creando dos intentos', async () => {
    const { quizzes } = newFixture();

    await quizzes.storeAttempt(IDS.user, IDS.quiz, IDS.article, '50.00', {
      [IDS.questionA]: 'a',
    });
    await quizzes.storeAttempt(IDS.user, IDS.quiz, IDS.article, '50.00', {
      [IDS.questionA]: 'a',
    });

    const page = await quizzes.listAttempts(IDS.user, IDS.quiz, { limit: 20, offset: 0 });
    expect(page.total).toBe(2);
  });

  it('un intento peor NO borra ni sustituye al anterior', async () => {
    const { quizzes } = newFixture();

    await quizzes.storeAttempt(IDS.user, IDS.quiz, IDS.article, '100.00', {});
    await quizzes.storeAttempt(IDS.user, IDS.quiz, IDS.article, '25.00', {});

    // FR-016 exige el historial COMPLETO. Filtrar los intentos peores dejaría un
    // historial que no permite ver la propia progresión, que es para lo que existe.
    const page = await quizzes.listAttempts(IDS.user, IDS.quiz, { limit: 20, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.items.map((a) => a.score.toFixed(2))).toEqual(['25.00', '100.00']);
  });

  it('el historial se pagina por número de intento descendente', async () => {
    const { quizzes } = newFixture();
    for (const score of ['10.00', '20.00', '30.00']) {
      await quizzes.storeAttempt(IDS.user, IDS.quiz, IDS.article, score, {});
    }

    const page = await quizzes.listAttempts(IDS.user, IDS.quiz, { limit: 2, offset: 0 });

    expect(page.items.map((a) => a.attemptNo)).toEqual([3, 2]);
    expect(page.total).toBe(3);
  });

  it('los agregados del artículo se recalculan con cada intento', async () => {
    const { quizzes, pool } = newFixture();

    await quizzes.storeAttempt(IDS.user, IDS.quiz, IDS.article, '80.00', {});
    await quizzes.storeAttempt(IDS.user, IDS.quiz, IDS.article, '60.00', {});

    const stats = await pool.query<{ attempt_count: string; avg_score: string }>(
      'SELECT attempt_count, avg_score FROM article_stats WHERE article_id = $1',
      [IDS.article],
    );
    expect(Number(stats.rows[0]?.attempt_count)).toBe(2);
    // Recalculado, no acumulado: un promedio incremental redondeado en cada paso
    // acabaría diciendo algo que los propios intentos desmienten.
    expect(new Decimal(stats.rows[0]?.avg_score ?? '0').equals(new Decimal('70'))).toBe(true);
  });

  it('la calificación se guarda con su escala exacta', async () => {
    const { quizzes, pool } = newFixture();

    await quizzes.storeAttempt(IDS.user, IDS.quiz, IDS.article, '85.55', {});

    // Si el driver recibiera un `number`, el `NUMERIC(6,2)` acabaría con el valor más
    // cercano representable en binario y no con el que se calculó (Principio VIII).
    const row = await pool.query<{ score: string }>(
      'SELECT score FROM quiz_attempts WHERE user_id = $1',
      [IDS.user],
    );
    expect(new Decimal(row.rows[0]?.score ?? '0').toFixed(2)).toBe('85.55');
  });
});
