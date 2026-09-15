/**
 * Calificación de cuestionarios (FR-012, FR-016) y su historial (FR-029).
 *
 * Es el módulo financieramente sensible del servicio: aquí se calcula un `score` que
 * después se convierte en los puntos de progreso del usuario. El Principio VIII
 * (NON-NEGOTIABLE) prohíbe `number` en todo este directorio, así que el cálculo entero
 * ocurre en `Decimal` y solo se serializa a `string` canónica al cruzar la frontera.
 *
 * La regla que gobierna el flujo: **el intento se persiste SIEMPRE**, apruebe o no,
 * supere o no el mejor histórico (FR-016). Quien decide si ese puntaje mueve los
 * puntos es el Servicio de Usuarios (`ApplyQuizScore`, idempotente y monótono); aquí
 * no se filtra nada, porque un historial con huecos ya no es un historial.
 */
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

import type { Count } from '../common/counts';
import { format, roundHalfEven } from '../common/decimal-str';
import { conflict, invalidArgument, notFound } from '../common/errors';
import { nextPageToken, resolvePage, type PageRequestLike } from '../common/pagination';
import type { AttemptSummary, GradingKey } from '../quizzes/quizzes.repository';
import { QuizzesRepository } from '../quizzes/quizzes.repository';
import type { ServedQuestion } from '../quizzes/sessions.repository';
import { SessionsRepository } from '../quizzes/sessions.repository';

/** Resultado de calificar un intento. */
export interface GradeResult {
  readonly attemptId: string;
  readonly attemptNo: Count;
  readonly score: Decimal;
  readonly passed: boolean;
  /** Sesión que se calificó (FR-039), para devolverla en la respuesta. */
  readonly sessionId: string;
}

/** Página del historial de intentos. */
export interface AttemptsPage {
  readonly items: readonly AttemptSummary[];
  readonly nextPageToken: string;
  readonly totalSize: Count;
}

/** Un UUID canónico en cualquiera de sus versiones. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Escala de la calificación: 0–100, con dos decimales.
 *
 * Coincide con `NUMERIC(6,2)` de `quiz_attempts.score` y con la de `pass_threshold`,
 * que es lo que permite compararlos sin convertir nada.
 */
const FULL_MARK = new Decimal(100);
const SCORE_SCALE: Count = 2;

@Injectable()
export class GradingService {
  public constructor(
    private readonly quizzes: QuizzesRepository,
    private readonly sessions: SessionsRepository,
  ) {}

  /**
   * Califica un intento y lo persiste (FR-012, FR-016, FR-038…FR-042).
   *
   * Lo invoca la Saga de calificación (research D-07), nunca el cliente directamente:
   * el puntaje tiene que llegar a Usuarios en la misma secuencia, y esa coordinación
   * es del Orquestador.
   *
   * El intento se califica SOLO contra las preguntas servidas en la sesión emitida
   * (FR-040), no contra el banco entero: una respuesta a una pregunta no servida es un
   * conflicto y no se califica. La sesión, además, debe estar vigente y no consumida.
   *
   * @throws {DomainError} `invalid_argument` si los identificadores no son UUID;
   *   `not_found` si el cuestionario no existe; `conflict` si la sesión no existe, no
   *   pertenece al usuario o al cuestionario, venció, ya fue consumida, o las
   *   respuestas mencionan preguntas no servidas.
   */
  public async gradeAndStore(
    userId: string,
    quizId: string,
    sessionId: string,
    answers: Readonly<Record<string, string>>,
    idempotencyKey: string | null = null,
  ): Promise<GradeResult> {
    requireUuid('user_id', userId);
    requireUuid('quiz_id', quizId);
    requireUuid('session_id', sessionId);

    // La sesión es la fuente de verdad de QUÉ se sirvió. Se valida antes de tocar el
    // intento: una sesión vencida, consumida o ajena no puede calificar nada.
    const session = await this.sessions.findById(sessionId);
    if (session === null) {
      throw conflict(`no existe la sesión ${sessionId}`);
    }
    if (session.userId !== userId) {
      throw conflict(`la sesión ${sessionId} no pertenece a ${userId}`);
    }
    if (session.quizId !== quizId) {
      throw conflict(`la sesión ${sessionId} no corresponde al cuestionario ${quizId}`);
    }
    if (session.consumedAt !== null) {
      throw conflict(`la sesión ${sessionId} ya fue consumida (FR-042)`);
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw conflict(`la sesión ${sessionId} venció (FR-042)`);
    }

    const key = await this.quizzes.findGradingKey(quizId);
    if (key === null) {
      throw notFound(`no existe el cuestionario ${quizId}`);
    }

    // Una respuesta a una pregunta NO SERVIDA es un conflicto (FR-040): el cliente
    // pudo haber mezclado dos sesiones o construido mal la petición. Silenciarlo
    // produciría una nota que nadie puede explicar.
    const servedIds = new Set(session.served.map((served) => served.questionId));
    for (const questionId of Object.keys(answers)) {
      if (!servedIds.has(questionId)) {
        throw conflict(`la pregunta ${questionId} no fue servida en la sesión ${sessionId}`);
      }
    }

    const score = computeScoreOver(key, session.served, answers);
    const stored = await this.quizzes.storeAttempt(
      userId,
      quizId,
      key.articleId,
      // La calificación viaja al driver como cadena canónica. Un `number` acabaría
      // como `double` en un `NUMERIC(6,2)` y la nota perdería exactitud en el último
      // tramo (Principio VIII).
      format(score),
      answers,
      idempotencyKey,
      sessionId,
      session.served,
    );

    // Consumir la sesión tras persistir el intento: el orden (primero el intento,
    // luego la consumición) protege FR-016 — si la consumición fallara, el intento ya
    // está guardado y la saga puede reintentar con la misma clave de idempotencia.
    await this.sessions.markConsumed(sessionId);

    return {
      attemptId: stored.attemptId,
      attemptNo: stored.attemptNo,
      score,
      sessionId,
      // `gte` y no `>`: comparar `Decimal` con operadores relacionales de JavaScript
      // los convierte a `number`, que es exactamente lo que este módulo evita.
      passed: score.gte(key.passThreshold),
    };
  }

  /**
   * Historial completo y paginado de intentos (FR-016, FR-029).
   *
   * Devuelve TODOS los intentos, no solo el mejor: la ruta de lectura de FR-016 es la
   * que permite a una persona ver su propia progresión, y quedarse solo con el máximo
   * la borraría.
   *
   * `quizId` VACÍO es válido y significa «todos los cuestionarios del usuario» —
   * no se exige que sea UUID en ese caso. Es lo que usa
   * `UsersService.GetActivityReport` para contar `quizzes_attempted` sin conocer
   * cada cuestionario de antemano (plan.md N-02, `users/internal/server/mapping.go`)
   * y lo que usa `GET /me/data` del Gateway para el historial completo (FR-029).
   */
  public async listAttempts(
    userId: string,
    quizId: string,
    page: PageRequestLike | undefined,
  ): Promise<AttemptsPage> {
    requireUuid('user_id', userId);
    if (quizId !== '') {
      requireUuid('quiz_id', quizId);
    }

    const window = resolvePage(page);
    const result = await this.quizzes.listAttempts(userId, quizId, window);

    return {
      items: result.items,
      nextPageToken: nextPageToken(window, result.items.length, result.total),
      totalSize: result.total,
    };
  }

  /**
   * Paso de la Saga de anonimización que le corresponde a este servicio
   * (FR-030, D-08).
   *
   * Es un no-op DELIBERADO, no un esqueleto sin terminar: `quiz_attempts` no
   * tiene ninguna columna de PII que disociar (a diferencia de
   * `services/auth-server` o `services/users`, cuyo esquema anota
   * explícitamente qué columnas son «anonimizables»). El único identificador de
   * la fila es `user_id`, que ya es un UUID opaco y DEBE seguir siéndolo
   * después de esta llamada: es el mismo correlador que usa
   * `Users.GetActivityReport` para contar `quizzes_attempted`, y una vez que
   * Auth y Usuarios anonimizan la identidad detrás de ese UUID, el propio
   * identificador deja de señalar a nadie sin que este servicio tenga que
   * tocar una sola fila (ver la nota equivalente en
   * `services/users/internal/server/anonymize.go`).
   *
   * Sigue existiendo como RPC —y la Saga lo sigue invocando— porque `Aprendizaje`
   * está en el alcance de FR-030 y una implementación futura que SÍ añadiera una
   * columna con datos personales (por ejemplo, un comentario libre del usuario)
   * tiene que encontrar aquí el paso listo para vaciarla, no un servicio que
   * nunca aprendió a hacerlo.
   *
   * @throws {DomainError} `invalid_argument` si `userId` no es un UUID.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- no-op documentado; ver arriba
  public async anonymizeAttempts(userId: string): Promise<void> {
    requireUuid('user_id', userId);
  }
}

/**
 * Calcula la calificación sobre 100 con los pesos de las preguntas SERVIDAS (FR-041).
 *
 * Una pregunta servida SIN responder cuenta como incorrecta y no se excluye del
 * denominador: excluirla convertiría dejar preguntas en blanco en una estrategia.
 *
 * Si una pregunta servida ya no está en el banco (el editor editó el cuestionario
 * entre la sesión y la calificación), se excluye de numerador y denominador — es la
 * salvedad de research D-18, no hay forma de conocer el peso histórico servido.
 *
 * El redondeo es half-even (bancario) y ocurre UNA vez, al final.
 */
function computeScoreOver(
  key: GradingKey,
  served: readonly ServedQuestion[],
  answers: Readonly<Record<string, string>>,
): Decimal {
  let total = new Decimal(0);
  let earned = new Decimal(0);

  for (const entry of served) {
    const expected = key.answers.get(entry.questionId);
    if (expected === undefined) {
      continue;
    }
    total = total.plus(expected.weight);
    if (answers[entry.questionId] === expected.correctKey) {
      earned = earned.plus(expected.weight);
    }
  }

  if (total.isZero()) {
    // Inalcanzable con el CHECK `questions_weight_positive` del esquema, pero una
    // división por cero silenciosa daría `NaN` y `NaN` acabaría en la base como una
    // calificación. Vale más una nota de cero que un dato imposible.
    return new Decimal(0);
  }

  return roundHalfEven(earned.dividedBy(total).times(FULL_MARK), SCORE_SCALE);
}

/**
 * Comprueba que un identificador sea un UUID antes de que llegue al SQL.
 *
 * @throws {DomainError} `invalid_argument`.
 */
function requireUuid(field: string, value: string): void {
  if (!UUID.test(value)) {
    throw invalidArgument(`${field} no es un UUID: ${JSON.stringify(value)}`);
  }
}
