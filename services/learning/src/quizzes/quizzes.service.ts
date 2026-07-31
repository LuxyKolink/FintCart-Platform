/**
 * Capa de aplicación de cuestionarios (Principio IX).
 *
 * Sirve el cuestionario a quien va a responderlo. La corrección NO está aquí: vive en
 * `grading/`, y esa separación es la que permite que este servicio nunca tenga en la
 * mano un objeto que contenga las respuestas correctas.
 */
import { Injectable } from '@nestjs/common';

import { invalidArgument, notFound } from '../common/errors';

import type { Quiz } from './quizzes.repository';
import { QuizzesRepository } from './quizzes.repository';

/** Un UUID canónico en cualquiera de sus versiones. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
}
