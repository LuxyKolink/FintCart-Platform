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

/** Resultado de calificar un intento. */
export interface GradeResult {
  readonly attemptId: string;
  readonly attemptNo: Count;
  readonly score: Decimal;
  readonly passed: boolean;
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
  public constructor(private readonly quizzes: QuizzesRepository) {}

  /**
   * Califica un intento y lo persiste (FR-012, FR-016).
   *
   * Lo invoca la Saga de calificación (research D-07), nunca el cliente directamente:
   * el puntaje tiene que llegar a Usuarios en la misma secuencia, y esa coordinación
   * es del Orquestador.
   *
   * @throws {DomainError} `invalid_argument` si los identificadores no son UUID o las
   *   respuestas mencionan preguntas ajenas al cuestionario; `not_found` si el
   *   cuestionario no existe; `conflict` si el cuestionario no tiene preguntas.
   */
  public async gradeAndStore(
    userId: string,
    quizId: string,
    answers: Readonly<Record<string, string>>,
  ): Promise<GradeResult> {
    requireUuid('user_id', userId);
    requireUuid('quiz_id', quizId);

    const key = await this.quizzes.findGradingKey(quizId);
    if (key === null) {
      throw notFound(`no existe el cuestionario ${quizId}`);
    }
    if (key.answers.size === 0) {
      // Un cuestionario sin preguntas no se puede calificar: cualquier puntaje sería
      // inventado. FR-009 exige al menos una, así que esto es un cuestionario a medio
      // crear y no una entrada legítima.
      throw conflict(`el cuestionario ${quizId} no tiene preguntas`);
    }

    // Una respuesta a una pregunta que no es de este cuestionario indica que el
    // cliente mezcló dos cuestionarios o construyó mal la petición. Ignorarla en
    // silencio produciría una nota que el usuario no entiende y nadie puede explicar.
    for (const questionId of Object.keys(answers)) {
      if (!key.answers.has(questionId)) {
        throw invalidArgument(`la pregunta ${questionId} no pertenece al cuestionario ${quizId}`);
      }
    }

    const score = computeScore(key, answers);
    const stored = await this.quizzes.storeAttempt(
      userId,
      quizId,
      key.articleId,
      // La calificación viaja al driver como cadena canónica. Un `number` acabaría
      // como `double` en un `NUMERIC(6,2)` y la nota perdería exactitud en el último
      // tramo (Principio VIII).
      format(score),
      answers,
    );

    return {
      attemptId: stored.attemptId,
      attemptNo: stored.attemptNo,
      score,
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
 * Calcula la calificación sobre 100 con los pesos de cada pregunta.
 *
 * Una pregunta SIN responder cuenta como incorrecta y no se excluye del denominador.
 * Excluirla convertiría dejar preguntas en blanco en una estrategia: quien respondiera
 * solo la que sabe sacaría un 100.
 *
 * El redondeo es half-even (bancario) y ocurre UNA vez, al final. Redondear en cada
 * pregunta acumularía el sesgo del redondeo tantas veces como preguntas tenga el
 * cuestionario.
 */
function computeScore(key: GradingKey, answers: Readonly<Record<string, string>>): Decimal {
  let total = new Decimal(0);
  let earned = new Decimal(0);

  for (const [questionId, expected] of key.answers) {
    total = total.plus(expected.weight);
    if (answers[questionId] === expected.correctKey) {
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
