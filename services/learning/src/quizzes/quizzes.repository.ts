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
import { DomainError, notFound, storageError } from '../common/errors';
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

/** Una pregunta a escribir, con su clave de corrección (T162, flujo editorial). */
export interface QuestionInput {
  readonly prompt: string;
  readonly options: Readonly<Record<string, string>>;
  readonly correctKey: string;
  /** Cadena decimal canónica — el llamador ya la validó con `parseScore`. */
  readonly weight: string;
}

/** Reemplazo COMPLETO de un cuestionario (T162). `quizId` vacío ⇒ crear uno nuevo. */
export interface UpsertQuizInput {
  readonly quizId: string;
  readonly articleId: string;
  readonly title: string;
  /** Cadena decimal canónica — el llamador ya la validó con `parseScore`. */
  readonly passThreshold: string;
  readonly questions: readonly QuestionInput[];
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

/**
 * `ON CONFLICT (idempotency_key) DO NOTHING`: si el motor de sagas del
 * Orquestador reintenta este paso (avance no confirmado, T176), la clave ya
 * reclamada por el intento ORIGINAL hace que este segundo `INSERT` no devuelva
 * fila — [[QuizzesRepository.storeAttempt]] relee entonces la existente en vez
 * de dejar un intento fantasma. Sin `idempotency_key` (`NULL`), el `INSERT`
 * siempre tiene éxito y se comporta como antes de T176: un `UNIQUE` no considera
 * dos `NULL` iguales entre sí, así que nunca hay conflicto que resolver. El índice
 * no es parcial (`quiz_attempts_idempotency_key_unique`, sin `WHERE`) a propósito:
 * `pg-mem` no soporta `ON CONFLICT (col) WHERE ... DO NOTHING`, y un índice
 * parcial habría exigido esa cláusula para que Postgres infiriera el arbitraje.
 */
const INSERT_ATTEMPT_SQL = `
INSERT INTO quiz_attempts (user_id, quiz_id, attempt_no, score, answers, idempotency_key)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id, attempt_no`;

const FIND_ATTEMPT_BY_IDEMPOTENCY_KEY_SQL = `
SELECT id, attempt_no FROM quiz_attempts WHERE idempotency_key = $1`;

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

/**
 * `quiz_id` es OPCIONAL: un `NULL` en `$2` (nunca una cadena vacía, que no es un
 * UUID válido para la columna) lista los intentos de TODOS los cuestionarios del
 * usuario. Es lo que necesita `UsersService.GetActivityReport` para contar
 * `quizzes_attempted` sin conocer cada `quiz_id` uno por uno (plan.md N-02) y lo
 * que necesita `GET /me/data` del Gateway para el historial completo del titular
 * (FR-029) — ver [[QuizzesRepository.listAttempts]].
 *
 * El orden es por `created_at` y no por `attempt_no`: `attempt_no` solo es
 * consecutivo DENTRO de un cuestionario, así que ordenar por él con varios
 * cuestionarios mezclados no reflejaría qué se respondió más recientemente. El
 * desempate por `id` evita que dos intentos con la misma marca —posible si dos
 * llegan en la misma transacción— cambien de orden entre páginas.
 */
const LIST_ATTEMPTS_SQL = `
SELECT id, attempt_no, score::text AS score, created_at
  FROM quiz_attempts
 WHERE user_id = $1 AND ($2::uuid IS NULL OR quiz_id = $2::uuid)
 ORDER BY created_at DESC, id DESC
 LIMIT $3 OFFSET $4`;

const COUNT_ATTEMPTS_SQL = `
SELECT count(*) AS total FROM quiz_attempts WHERE user_id = $1 AND ($2::uuid IS NULL OR quiz_id = $2::uuid)`;

// `id` sale de `gen_random_uuid()` explícito y no del `DEFAULT` de la columna — ver el
// comentario equivalente de `publishing.repository.ts::INSERT_ARTICLE_SQL`.
const INSERT_QUIZ_SQL = `
INSERT INTO quizzes (id, article_id, title, pass_threshold)
VALUES (gen_random_uuid(), $1, $2, $3)
RETURNING id, article_id`;

const UPDATE_QUIZ_SQL = `
UPDATE quizzes SET title = $2, pass_threshold = $3
 WHERE id = $1
RETURNING id, article_id`;

const DELETE_QUESTIONS_SQL = `DELETE FROM questions WHERE quiz_id = $1`;

const INSERT_QUESTION_SQL = `
INSERT INTO questions (id, quiz_id, prompt, options, correct_key, weight, position)
VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`;

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

/**
 * Reintentos ante colisión de `attempt_no` entre intentos simultáneos del MISMO
 * usuario (T175, SC-005: hallazgo real de la prueba de carga).
 *
 * 3 —el valor original— bastaba para el caso que el comentario de
 * [[NEXT_ATTEMPT_NO_SQL]] describe explícitamente: DOS intentos a la vez (dos
 * pestañas, un reintento de red). Contra el fondo de cuentas de
 * `k6-scenarios.js`, donde varios VU comparten a propósito una misma cuenta
 * para no pagar el registro completo por cada uno (ver su comentario), la
 * concurrencia por cuenta sube de 2 a varias decenas, y 3 reintentos sin ningún
 * espaciado agotaban la cuota antes de que la carrera se resolviera: el
 * `INSERT` de esta vuelta ve el `MAX` de la anterior, todavía sin confirmar, y
 * vuelve a chocar. 10 reintentos con una espera exponencial corta y con
 * fluctuación (`jitter`, [[backoff]]) resuelven eso reduciendo la probabilidad
 * de que dos transacciones sigan compitiendo por la MISMA ventana en cada
 * vuelta, sin convertir una colisión genuina en una espera larga para el caso
 * normal de dos pestañas.
 */
const ATTEMPT_RETRIES: Count = 10;

/** Duerme un intervalo corto y aleatorio antes de reintentar (ver `ATTEMPT_RETRIES`). */
function backoff(attempt: Count): Promise<void> {
  const baseMs: Count = Math.min(50 * 2 ** attempt, 400);
  const jitterMs: Count = Math.random() * baseMs;
  return new Promise((resolve) => setTimeout(resolve, jitterMs));
}

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
   * Reemplaza COMPLETO un cuestionario y sus preguntas (T162), en una transacción.
   *
   * Se BORRA e INSERTA de nuevo en lugar de un CRUD por pregunta: un cuestionario a
   * medio editar —tres preguntas nuevas y dos viejas conviviendo— es peor que no poder
   * editar una pregunta suelta, y el `position` de cada una queda exactamente en el
   * orden del array de entrada sin tener que reconciliar índices.
   *
   * `quizId` vacío crea un cuestionario NUEVO; no vacío reemplaza uno existente y
   * conserva su `article_id` (el de la entrada se ignora en ese caso — ver el
   * comentario de `UpsertQuizRequest` en el `.proto`).
   *
   * @throws {DomainError} `not_found` si `quizId` no existe (al actualizar) o
   *   `articleId` no existe (al crear); `storage` si alguna `correct_key` no está entre
   *   las opciones de su pregunta (CHECK `questions_correct_key_in_options`).
   */
  public async upsertQuiz(input: UpsertQuizInput): Promise<Quiz> {
    try {
      return await execTx(this.pool, async (client: PoolClient) => {
        const row =
          input.quizId === ''
            ? await client.query<{ id: string; article_id: string }>(INSERT_QUIZ_SQL, [
                input.articleId,
                input.title,
                input.passThreshold,
              ])
            : await client.query<{ id: string; article_id: string }>(UPDATE_QUIZ_SQL, [
                input.quizId,
                input.title,
                input.passThreshold,
              ]);
        const quiz = row.rows[0];
        if (quiz === undefined) {
          throw notFound(
            input.quizId === '' ? `no existe el artículo ${input.articleId}` : `no existe el cuestionario ${input.quizId}`,
          );
        }

        await client.query(DELETE_QUESTIONS_SQL, [quiz.id]);
        for (const [index, question] of input.questions.entries()) {
          await client.query(INSERT_QUESTION_SQL, [
            quiz.id,
            question.prompt,
            JSON.stringify(question.options),
            question.correctKey,
            question.weight,
            index + 1,
          ]);
        }

        return {
          quizId: quiz.id,
          articleId: quiz.article_id,
          title: input.title,
          passThreshold: parseScore(input.passThreshold),
          // Las preguntas se devuelven tal como se enviaron, SIN releerlas: el `INSERT`
          // ya confirmó (dentro de esta misma transacción) que son válidas, y una
          // relectura solo repetiría en otra consulta lo que este método ya sabe.
          // `questionId` queda vacío porque `INSERT_QUESTION_SQL` no lo devuelve — el
          // llamador (`UpsertQuiz` por gRPC) no lo necesita: quien edita un cuestionario
          // vuelve a mandarlo completo la próxima vez, no por pregunta suelta.
          questions: input.questions.map((q) => ({
            questionId: '',
            prompt: q.prompt,
            options: Object.entries(q.options)
              .map(([key, text]) => ({ key, text }))
              .sort((a, b) => a.key.localeCompare(b.key)),
            weight: parseScore(q.weight),
          })),
        };
      });
    } catch (err) {
      if (err instanceof DomainError) {
        throw err;
      }
      throw storageError(
        input.quizId === '' ? `crear el cuestionario de ${input.articleId}` : `editar el cuestionario ${input.quizId}`,
        err,
      );
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
    idempotencyKey: string | null = null,
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
            [
              userId,
              quizId,
              next.rows[0]?.next_no ?? 1,
              score,
              JSON.stringify(answers),
              idempotencyKey,
            ],
          );
          const row = inserted.rows[0];
          if (row === undefined) {
            // Sin fila: o el `INSERT ... SELECT` fallara sin lanzar (imposible, el
            // agregado siempre devuelve una), o —el caso real— `idempotencyKey` ya
            // estaba reclamado por un reintento anterior de esta MISMA saga (T176).
            // Se relee el intento existente en vez de tratarlo como un fallo.
            if (idempotencyKey === null) {
              throw storageError('registrar el intento', new Error('el INSERT no devolvió fila'));
            }
            const existing = await client.query<{ id: string; attempt_no: Count }>(
              FIND_ATTEMPT_BY_IDEMPOTENCY_KEY_SQL,
              [idempotencyKey],
            );
            const found = existing.rows[0];
            if (found === undefined) {
              throw storageError(
                'registrar el intento',
                new Error('conflicto de idempotencia sin fila que leer'),
              );
            }
            return { attemptId: found.id, attemptNo: found.attempt_no };
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
        await backoff(attempt);
      }
    }

    // Inalcanzable: el bucle o devuelve o lanza. Está para que el tipo de retorno no
    // dependa de que el compilador entienda esa propiedad.
    throw storageError('registrar el intento', new Error('reintentos agotados'));
  }

  /**
   * Historial completo y paginado de intentos (FR-016, FR-029).
   *
   * `quizId` vacío significa «todos los cuestionarios» — ver la nota de
   * [[LIST_ATTEMPTS_SQL]]. Se traduce a `null` aquí y no antes: es la frontera
   * entre «cadena vacía del contrato» y «ausencia de filtro para el driver», y
   * mezclarla con la validación de la capa de aplicación (`grading.service.ts`)
   * repartiría esta misma decisión en dos sitios.
   */
  public async listAttempts(
    userId: string,
    quizId: string,
    page: Page,
  ): Promise<Paged<AttemptSummary>> {
    const quizFilter = quizId === '' ? null : quizId;
    try {
      const [rows, count] = await Promise.all([
        this.pool.query<AttemptRow>(LIST_ATTEMPTS_SQL, [userId, quizFilter, page.limit, page.offset]),
        this.pool.query<{ total: string }>(COUNT_ATTEMPTS_SQL, [userId, quizFilter]),
      ]);

      return {
        items: rows.rows.map(toAttemptSummary),
        total: parseCount(count.rows[0]?.total),
      };
    } catch (err) {
      const scope = quizId === '' ? 'todos los cuestionarios' : `el cuestionario ${quizId}`;
      throw storageError(`listar los intentos de ${scope}`, err);
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
