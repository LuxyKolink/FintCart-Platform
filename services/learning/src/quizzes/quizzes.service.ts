/**
 * Capa de aplicación de cuestionarios (Principio IX).
 *
 * Sirve el cuestionario a quien va a responderlo. La corrección NO está aquí: vive en
 * `grading/`, y esa separación es la que permite que este servicio nunca tenga en la
 * mano un objeto que contenga las respuestas correctas.
 */
import { Injectable } from '@nestjs/common';
import type Decimal from 'decimal.js';

import type { Count } from '../common/counts';
import { format, parseScore } from '../common/decimal-str';
import { invalidArgument, notFound } from '../common/errors';

import type { Quiz, QuestionInput, UpsertQuizInput } from './quizzes.repository';
import { QuizzesRepository } from './quizzes.repository';

/** Un UUID canónico en cualquiera de sus versiones. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Al menos dos alternativas: una única opción no es una elección (FR-009). */
const MIN_OPTIONS = 2;

@Injectable()
export class QuizzesService {
  public constructor(private readonly repository: QuizzesRepository) {}

  /**
   * Cuestionario por su identificador (FR-009, FR-011).
   *
   * @throws {DomainError} `invalid_argument` si el id no es un UUID, `not_found` si no
   *   existe.
   */
  public async getQuiz(quizId: string): Promise<Quiz> {
    // Validar antes de consultar: un id con forma de texto libre haría que PostgreSQL
    // respondiera `invalid input syntax for type uuid`, y la capa de transporte lo
    // traduciría a un error interno — un 500 causado por un dato del cliente.
    if (!UUID.test(quizId)) {
      throw invalidArgument(`quiz_id no es un UUID: ${JSON.stringify(quizId)}`);
    }

    const quiz = await this.repository.findQuiz(quizId);
    if (quiz === null) {
      throw notFound(`no existe el cuestionario ${quizId}`);
    }
    return quiz;
  }

  /**
   * Reemplaza completo un cuestionario del flujo editorial (FR-009, T162).
   *
   * Valida ANTES de tocar el SQL, con el mismo motivo que el resto del servicio: un
   * `weight`/`pass_threshold` mal formado o una `correct_key` fuera de las opciones
   * debe verse como `invalid_argument` desde aquí, no como la violación de CHECK
   * genérica (`storage`/`INTERNAL`) que produciría dejarlo pasar hasta el `INSERT`.
   *
   * @throws {DomainError} `invalid_argument` si algún campo es inválido; `not_found`
   *   si el cuestionario o el artículo referenciado no existen.
   */
  public async upsertQuiz(
    quizId: string,
    articleId: string,
    title: string,
    passThreshold: string,
    questions: readonly RawQuestionInput[],
  ): Promise<Quiz> {
    if (quizId !== '') {
      if (!UUID.test(quizId)) {
        throw invalidArgument(`quiz_id no es un UUID: ${JSON.stringify(quizId)}`);
      }
    } else if (!UUID.test(articleId)) {
      throw invalidArgument(`article_id no es un UUID: ${JSON.stringify(articleId)}`);
    }
    if (title.trim() === '') {
      throw invalidArgument('title no puede estar vacío');
    }
    if (questions.length === 0) {
      throw invalidArgument('un cuestionario necesita al menos una pregunta (FR-009)');
    }

    const validated: QuestionInput[] = questions.map((q, index) => validateQuestion(q, index));

    const input: UpsertQuizInput = {
      quizId,
      articleId,
      title,
      passThreshold: format(parseScoreOrThrow('pass_threshold', passThreshold)),
      questions: validated,
    };
    return this.repository.upsertQuiz(input);
  }
}

/** Forma en la que la capa gRPC entrega cada pregunta, antes de validar. */
export interface RawQuestionInput {
  readonly prompt: string;
  readonly options: Readonly<Record<string, string>>;
  readonly correctKey: string;
  readonly weight: string;
}

function validateQuestion(q: RawQuestionInput, index: Count): QuestionInput {
  if (q.prompt.trim() === '') {
    throw invalidArgument(`la pregunta #${index + 1} no tiene enunciado`);
  }
  const optionKeys = Object.keys(q.options);
  if (optionKeys.length < MIN_OPTIONS) {
    throw invalidArgument(`la pregunta #${index + 1} necesita al menos ${MIN_OPTIONS} opciones`);
  }
  if (!optionKeys.includes(q.correctKey)) {
    throw invalidArgument(`la pregunta #${index + 1}: correct_key no está entre las opciones ofrecidas`);
  }

  return {
    prompt: q.prompt,
    options: q.options,
    correctKey: q.correctKey,
    weight: format(parseScoreOrThrow(`la pregunta #${index + 1}: weight`, q.weight)),
  };
}

function parseScoreOrThrow(field: string, value: string): Decimal {
  try {
    return parseScore(value);
  } catch (err) {
    throw invalidArgument(`${field}: ${err instanceof Error ? err.message : String(err)}`, err);
  }
}
