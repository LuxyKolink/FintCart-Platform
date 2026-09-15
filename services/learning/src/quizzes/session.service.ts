/**
 * Capa de aplicación de la sesión de intento de cuestionario (FR-038…FR-042, D-17).
 *
 * Sustituye a `GetQuiz` como camino de ejecución: el lector ya no recibe el banco
 * entero, sino una sesión con exactamente `questions_to_serve` preguntas, barajadas y
 * SIN la clave correcta. Lo que se sirvió —y en qué orden— queda persistido en
 * `quiz_sessions.served`, que es lo que luego le permite a la calificación comprobar
 * que cada respuesta corresponde a una pregunta realmente servida (FR-040).
 */
import { Injectable } from '@nestjs/common';
import type Decimal from 'decimal.js';

import { invalidArgument, notFound } from '../common/errors';
import type { QuizQuestion, Quiz } from './quizzes.repository';
import { QuizzesRepository } from './quizzes.repository';
import { ServedQuestion, SessionsRepository } from './sessions.repository';

/** Vigencia de la sesión (research D-17): 60 minutos. */
const SESSION_TTL_MS = 60 * 60 * 1000;

/** Un UUID canónico en cualquiera de sus versiones. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Sesión iniciada, lista para devolver al lector. */
export interface StartedSession {
  readonly sessionId: string;
  readonly quizId: string;
  readonly title: string;
  readonly passThreshold: Decimal;
  readonly expiresAt: string; // RFC-3339
  readonly questions: readonly QuizQuestion[]; // servidas, barajadas, sin clave
}

@Injectable()
export class SessionService {
  public constructor(
    private readonly quizzes: QuizzesRepository,
    private readonly sessions: SessionsRepository,
  ) {}

  /**
   * Inicia una sesión de intento (FR-038).
   *
   * @throws {DomainError} `invalid_argument` si los identificadores no son UUID;
   *   `not_found` si el cuestionario no existe; `conflict` si no tiene preguntas.
   */
  public async startSession(userId: string, quizId: string): Promise<StartedSession> {
    if (!UUID.test(userId)) {
      throw invalidArgument(`user_id no es un UUID: ${JSON.stringify(userId)}`);
    }
    if (!UUID.test(quizId)) {
      throw invalidArgument(`quiz_id no es un UUID: ${JSON.stringify(quizId)}`);
    }

    const quiz = await this.quizzes.findQuiz(quizId);
    if (quiz === null) {
      throw notFound(`no existe el cuestionario ${quizId}`);
    }

    const served = sampleServed(quiz);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const created = await this.sessions.create(userId, quizId, served.served, expiresAt);

    return {
      sessionId: created.sessionId,
      quizId: quiz.quizId,
      title: quiz.title,
      passThreshold: quiz.passThreshold,
      expiresAt: created.expiresAt.toISOString(),
      questions: served.questions,
    };
  }
}

/**
 * Baraja el banco, se queda con las `questions_to_serve` primeras (o todas si el
 * banco tiene menos — FR-038) y baraja también las opciones de cada pregunta.
 *
 * Devuelve tanto las preguntas listas para el lector como el `served` persistible
 * (pregunta + orden de opciones), de modo que el orden servido se registra tal cual
 * se presenta, sin reconstruirlo después.
 */
export function sampleServed(
  quiz: Quiz,
  random: () => number = Math.random,
): {
  served: ServedQuestion[];
  questions: QuizQuestion[];
} {
  const bank = shuffle(quiz.questions, random);
  const selected = bank.slice(0, quiz.questionsToServe);

  const served: ServedQuestion[] = [];
  const questions: QuizQuestion[] = [];
  for (const question of selected) {
    const options = shuffle(question.options, random);
    served.push({ questionId: question.questionId, optionKeys: options.map((o) => o.key) });
    questions.push({ ...question, options });
  }
  return { served, questions };
}

/** Fisher–Yates con una fuente de aleatoriedad inyectable (para poder probar). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}
