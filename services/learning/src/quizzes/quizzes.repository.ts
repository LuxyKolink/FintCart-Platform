/**
 * Persistencia de cuestionarios, preguntas e intentos (Principio IX: capa `storer`).
 *
 * Hay una decisión de diseño aquí que es de SEGURIDAD y no de estilo: el cuestionario
 * que se entrega al cliente y la clave de corrección se leen con métodos DISTINTOS
 * ([[QuizzesRepository.findQuiz]] y [[QuizzesRepository.findGradingKey]]).
 *
 * Podrían ser uno solo que devolviera todo y dejar que el mapeo a protobuf omitiera
 * `correct_key`. Pero entonces la respuesta correcta de cada pregunta viajaría dentro
 * del objeto que se pasa a la capa de transporte, y bastaría con que alguien añadiera
 * un campo al contrato —o un `console.log` en un handler— para publicar las soluciones
 * del examen. Con dos métodos, ese objeto sencillamente no existe.
 *
 * Principio VIII: `weight`, `pass_threshold` y `score` son `NUMERIC(6,2)` y viajan
 * como `Decimal` en el dominio. El driver `pg` entrega `NUMERIC` como STRING
 * precisamente para no perder precisión, y aquí se convierte a `Decimal` sin pasar
 * jamás por `number`.
 */
import { Inject, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { Pool, PoolClient } from 'pg';

import { PG_POOL } from '../common/database.module';
import { parseCount, type Count } from '../common/counts';
import { parseScore } from '../common/decimal-str';
import { storageError } from '../common/errors';
import type { Page } from '../common/pagination';
import { execTx } from '../common/tx';

/** Alternativa de respuesta, con su clave. */
export interface QuizOption {
  readonly key: string;
  readonly text: string;
}

/** Pregunta tal como se le entrega a quien va a responderla: SIN la clave correcta. */
export interface QuizQuestion {
  readonly questionId: string;
  readonly prompt: string;
  readonly options: readonly QuizOption[];
  readonly weight: Decimal;
}

/** Cuestionario publicable. */
export interface Quiz {
  readonly quizId: string;
  readonly articleId: string;
  readonly title: string;
  readonly passThreshold: Decimal;
  readonly questions: readonly QuizQuestion[];
}

/** Lo que hace falta para corregir, y que NUNCA sale de la capa de aplicación. */
export interface GradingKey {
  readonly quizId: string;
  readonly articleId: string;
  readonly passThreshold: Decimal;
  /** `question_id` → clave correcta y peso. */
  readonly answers: ReadonlyMap<string, { readonly correctKey: string; readonly weight: Decimal }>;
}

/** Intento persistido. */
export interface StoredAttempt {
  readonly attemptId: string;
  readonly attemptNo: Count;
}

/** Entrada del historial de intentos (FR-016). */
export interface AttemptSummary {
  readonly attemptId: string;
  readonly attemptNo: Count;
  readonly score: Decimal;
  readonly createdAt: string;
}

/** Página de resultados con su total. */
export interface Paged<T> {
  readonly items: readonly T[];
  readonly total: Count;
}

// ── SQL ─────────────────────────────────────────────────────────────────────

/**
 * Los `NUMERIC` se piden con `::text` EXPLÍCITO.
 *
 * El driver `pg` ya devuelve `NUMERIC` como string, así que el cast parece redundante
 * — y no lo es. `pg.types.setTypeParser(1700, parseFloat)` es un «arreglo» que
 * aparece en cualquier hilo de StackOverflow sobre por qué los importes «llegan como
 * texto», y basta con que alguien lo añada en cualquier punto del proceso para que
 * TODAS las calificaciones de este servicio pasen por un `double` sin que nada falle
 * ni avise (Principio VIII). Con el cast en la consulta, la columna llega como texto
 * pase lo que pase con la configuración global del driver.
 */
const FIND_QUIZ_SQL = `
SELECT id, article_id, title, pass_threshold::text AS pass_threshold
  FROM quizzes WHERE id = $1`;

/** El `correct_key` NO se selecciona aquí. Ver la cabecera del archivo. */
const FIND_QUESTIONS_SQL = `
SELECT id, prompt, options, weight::text AS weight
  FROM questions
 WHERE quiz_id = $1
 ORDER BY position, id`;

const FIND_GRADING_KEY_SQL = `
SELECT id, correct_key, weight::text AS weight FROM questions WHERE quiz_id = $1`;

/**
 * Siguiente número de intento de este usuario en este cuestionario.
 *
 * Va antes del `INSERT` y dentro de la misma transacción. Lo que hace correcto el
 * conjunto NO es que sean una o dos sentencias —en las dos formas hay una ventana en
 * la que dos intentos simultáneos leen el mismo máximo—, sino el índice
 * `UNIQUE (user_id, quiz_id, attempt_no)` más el reintento de
 * [[QuizzesRepository.storeAttempt]]: la transacción que pierde la carrera falla con
 * violación de unicidad y vuelve a intentarlo, viendo ya el intento ajeno.
 *
 * Un `attempt_no` duplicado sería mucho peor que un reintento: FR-016 exige un
 * historial completo y ORDENADO, y dos intentos con el mismo número no se pueden
 * ordenar.
 */
const NEXT_ATTEMPT_NO_SQL = `
SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next_no
  FROM quiz_attempts
 WHERE user_id = $1 AND quiz_id = $2`;

const INSERT_ATTEMPT_SQL = `
INSERT INTO quiz_attempts (user_id, quiz_id, attempt_no, score, answers)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, attempt_no`;

/**
 * Recalcula los agregados del artículo desde los intentos reales (D-06).
 *
 * Se RECALCULA en lugar de acumular incrementalmente. Un promedio acumulado
 * (`avg = (avg*n + score)/(n+1)`) redondeado a dos decimales en cada paso acumula
 * deriva: tras unos miles de intentos, el valor almacenado ya no es el promedio de
 * nada. Recalcular cuesta un escaneo por índice y siempre dice la verdad.
 */
const REFRESH_ARTICLE_STATS_SQL = `
INSERT INTO article_stats (article_id, attempt_count, avg_score)
SELECT q.article_id, count(*), round(avg(a.score), 2)
  FROM quiz_attempts a
  JOIN quizzes q ON q.id = a.quiz_id
 WHERE q.article_id = $1
 GROUP BY q.article_id
ON CONFLICT (article_id) DO UPDATE
   SET attempt_count = EXCLUDED.attempt_count,
       avg_score     = EXCLUDED.avg_score`;

const LIST_ATTEMPTS_SQL = `
SELECT id, attempt_no, score::text AS score, created_at
  FROM quiz_attempts
 WHERE user_id = $1 AND quiz_id = $2
 ORDER BY attempt_no DESC
 LIMIT $3 OFFSET $4`;

const COUNT_ATTEMPTS_SQL = `
SELECT count(*) AS total FROM quiz_attempts WHERE user_id = $1 AND quiz_id = $2`;

// ── filas ───────────────────────────────────────────────────────────────────

interface QuizRow {
  readonly id: string;
  readonly article_id: string;
  readonly title: string;
  readonly pass_threshold: string;
}

interface QuestionRow {
  readonly id: string;
  readonly prompt: string;
  readonly options: Record<string, string>;
  readonly weight: string;
}

interface GradingKeyRow {
  readonly id: string;
  readonly correct_key: string;
  readonly weight: string;
}

interface AttemptRow {
  readonly id: string;
  readonly attempt_no: Count;
  readonly score: string;
  readonly created_at: Date;
}

/** Código de PostgreSQL para violación de unicidad. */
const UNIQUE_VIOLATION = '23505';

/** Reintentos ante colisión de `attempt_no` entre intentos simultáneos. */
const ATTEMPT_RETRIES: Count = 3;

@Injectable()
export class QuizzesRepository {
  public constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Cuestionario con sus preguntas, SIN las respuestas correctas. */
  public async findQuiz(quizId: string): Promise<Quiz | null> {
    try {
      const quiz = await this.pool.query<QuizRow>(FIND_QUIZ_SQL, [quizId]);
      const row = quiz.rows[0];
      if (row === undefined) {
        return null;
      }

      const questions = await this.pool.query<QuestionRow>(FIND_QUESTIONS_SQL, [quizId]);
      return {
        quizId: row.id,
        articleId: row.article_id,
        title: row.title,
        passThreshold: parseScore(row.pass_threshold),
        questions: questions.rows.map(toQuestion),
      };
    } catch (err) {
      throw storageError(`leer el cuestionario ${quizId}`, err);
    }
  }

  /** Clave de corrección. Su resultado no debe cruzar la capa de transporte. */
  public async findGradingKey(quizId: string): Promise<GradingKey | null> {
    try {
      const quiz = await this.pool.query<QuizRow>(FIND_QUIZ_SQL, [quizId]);
      const row = quiz.rows[0];
      if (row === undefined) {
        return null;
      }

      const keys = await this.pool.query<GradingKeyRow>(FIND_GRADING_KEY_SQL, [quizId]);
      const answers = new Map<string, { correctKey: string; weight: Decimal }>();
      for (const key of keys.rows) {
        answers.set(key.id, { correctKey: key.correct_key, weight: parseScore(key.weight) });
      }

      return {
        quizId: row.id,
        articleId: row.article_id,
        passThreshold: parseScore(row.pass_threshold),
        answers,
      };
    } catch (err) {
      throw storageError(`leer la clave de corrección del cuestionario ${quizId}`, err);
    }
  }

  /**
   * Persiste el intento y refresca los agregados del artículo, en una transacción.
   *
   * Las dos escrituras van juntas porque un intento registrado cuyo agregado no se
   * actualiza deja `article_stats` diciendo algo que los propios intentos desmienten,
   * y nada volvería a corregirlo: el refresco solo ocurre cuando llega un intento
   * nuevo.
   *
   * `score` se pasa como la cadena decimal canónica y no como `number`: el driver
   * enviaría un `double` al `NUMERIC(6,2)` y la calificación perdería exactitud en el
   * último tramo (Principio VIII).
   */
  public async storeAttempt(
    userId: string,
    quizId: string,
    articleId: string,
    score: string,
    answers: Readonly<Record<string, string>>,
  ): Promise<StoredAttempt> {
    for (let attempt = 0; attempt < ATTEMPT_RETRIES; attempt += 1) {
      try {
        return await execTx(this.pool, async (client: PoolClient) => {
          const next = await client.query<{ next_no: Count }>(NEXT_ATTEMPT_NO_SQL, [
            userId,
            quizId,
          ]);
          const inserted = await client.query<{ id: string; attempt_no: Count }>(
            INSERT_ATTEMPT_SQL,
            [userId, quizId, next.rows[0]?.next_no ?? 1, score, JSON.stringify(answers)],
          );
          const row = inserted.rows[0];
          if (row === undefined) {
            // `INSERT ... SELECT` sin filas es imposible aquí —el `SELECT` con
            // agregado siempre devuelve una—, pero devolver un id vacío en silencio
            // sería mucho peor que fallar.
            throw storageError('registrar el intento', new Error('el INSERT no devolvió fila'));
          }

          await client.query(REFRESH_ARTICLE_STATS_SQL, [articleId]);
          return { attemptId: row.id, attemptNo: row.attempt_no };
        });
      } catch (err) {
        // Colisión de `attempt_no` entre dos intentos simultáneos del mismo usuario:
        // se reintenta, porque el siguiente cálculo del máximo ya verá el intento
        // ajeno. Cualquier otro error se propaga tal cual.
        if (!isUniqueViolation(err) || attempt === ATTEMPT_RETRIES - 1) {
          throw err;
        }
      }
    }

    // Inalcanzable: el bucle o devuelve o lanza. Está para que el tipo de retorno no
    // dependa de que el compilador entienda esa propiedad.
    throw storageError('registrar el intento', new Error('reintentos agotados'));
  }

  /** Historial completo y paginado de intentos (FR-016, FR-029). */
  public async listAttempts(
    userId: string,
    quizId: string,
    page: Page,
  ): Promise<Paged<AttemptSummary>> {
    try {
      const [rows, count] = await Promise.all([
        this.pool.query<AttemptRow>(LIST_ATTEMPTS_SQL, [userId, quizId, page.limit, page.offset]),
        this.pool.query<{ total: string }>(COUNT_ATTEMPTS_SQL, [userId, quizId]),
      ]);

      return {
        items: rows.rows.map(toAttemptSummary),
        total: parseCount(count.rows[0]?.total),
      };
    } catch (err) {
      throw storageError(`listar los intentos del cuestionario ${quizId}`, err);
    }
  }
}

/**
 * Fila → pregunta (Principio IX regla 3).
 *
 * `options` es un JSONB `{clave: enunciado}` y se aplana a una lista ORDENADA por
 * clave. El orden del objeto JSON no está garantizado entre lecturas, y sin un orden
 * estable la misma pregunta aparecería con las opciones barajadas en cada recarga —
 * lo que parece un fallo del cliente y no lo es.
 */
function toQuestion(row: QuestionRow): QuizQuestion {
  const options = Object.entries(row.options ?? {})
    .map(([key, text]) => ({ key, text }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    questionId: row.id,
    prompt: row.prompt,
    options,
    weight: parseScore(row.weight),
  };
}

/** Fila → entrada del historial. */
function toAttemptSummary(row: AttemptRow): AttemptSummary {
  return {
    attemptId: row.id,
    attemptNo: row.attempt_no,
    score: parseScore(row.score),
    // RFC-3339 UTC, como exige el contrato. `toISOString()` siempre emite `Z`.
    createdAt: row.created_at.toISOString(),
  };
}

/** `true` si el error de `pg` es una violación de unicidad. */
function isUniqueViolation(err: unknown): boolean {
  const cause = err instanceof Error && err.cause !== undefined ? err.cause : err;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === UNIQUE_VIOLATION
  );
}
