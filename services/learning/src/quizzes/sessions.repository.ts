/**
 * Persistencia de las sesiones de intento de cuestionario (Principio IX: `storer`).
 *
 * La sesión es el estado de dominio de FR-038…FR-042 (research D-17): qué preguntas se
 * sirvieron, en qué orden y con qué orden de opciones. Vive en `learning_db` y NUNCA en
 * Redis (Principio IV) ni en el cliente (el navegador no puede declarar qué se le
 * sirvió, o FR-040 sería incumplible).
 *
 * El JSONB `served` guarda `[{question_id, option_keys[]}]`. La clave correcta de cada
 * pregunta NO está aquí: se lee aparte por `question_id` en el momento de calificar, y
 * ese objeto (preguntas + respuestas correctas) nunca cruza la capa de transporte.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { PG_POOL } from '../common/database.module';
import type { Count } from '../common/counts';
import { storageError } from '../common/errors';

/** Una pregunta servida, con el orden en que se presentaron sus opciones. */
export interface ServedQuestion {
  readonly questionId: string;
  readonly optionKeys: readonly string[];
}

/** Sesión tal como la lee la capa de aplicación. */
export interface QuizSessionRecord {
  readonly sessionId: string;
  readonly userId: string;
  readonly quizId: string;
  readonly served: readonly ServedQuestion[];
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

const INSERT_SESSION_SQL = `
INSERT INTO quiz_sessions (id, user_id, quiz_id, served, expires_at)
VALUES (gen_random_uuid(), $1, $2, $3, $4)
RETURNING id, expires_at`;

const FIND_SESSION_SQL = `
SELECT id, user_id, quiz_id, served, expires_at, consumed_at
  FROM quiz_sessions WHERE id = $1`;

// `WHERE consumed_at IS NULL` es la guarda que hace la consumición idempotente: si otra
// petición ya consumió la sesión, este `UPDATE` no toca ninguna fila.
const MARK_CONSUMED_SQL = `
UPDATE quiz_sessions SET consumed_at = now()
 WHERE id = $1 AND consumed_at IS NULL
RETURNING id`;

const SWEEP_EXPIRED_SQL = `
DELETE FROM quiz_sessions
 WHERE expires_at < now() AND consumed_at IS NULL
RETURNING id`;

interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly quiz_id: string;
  readonly served: readonly { question_id: string; option_keys: readonly string[] }[];
  readonly expires_at: Date;
  readonly consumed_at: Date | null;
}

@Injectable()
export class SessionsRepository {
  public constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Crea una sesión y devuelve su identificador y su caducidad. */
  public async create(
    userId: string,
    quizId: string,
    served: readonly ServedQuestion[],
    expiresAt: Date,
  ): Promise<{ sessionId: string; expiresAt: Date }> {
    try {
      const result = await this.pool.query<{ id: string; expires_at: Date }>(INSERT_SESSION_SQL, [
        userId,
        quizId,
        JSON.stringify(served.map((s) => ({ question_id: s.questionId, option_keys: s.optionKeys }))),
        expiresAt,
      ]);
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error('el INSERT no devolvió fila');
      }
      return { sessionId: row.id, expiresAt: row.expires_at };
    } catch (err) {
      throw storageError(`crear la sesión de ${quizId} para ${userId}`, err);
    }
  }

  /** Sesión por su identificador, o `null` si no existe. */
  public async findById(sessionId: string): Promise<QuizSessionRecord | null> {
    try {
      const result = await this.pool.query<SessionRow>(FIND_SESSION_SQL, [sessionId]);
      const row = result.rows[0];
      if (row === undefined) {
        return null;
      }
      return {
        sessionId: row.id,
        userId: row.user_id,
        quizId: row.quiz_id,
        served: row.served.map((entry) => ({
          questionId: entry.question_id,
          optionKeys: entry.option_keys,
        })),
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
      };
    } catch (err) {
      throw storageError(`leer la sesión ${sessionId}`, err);
    }
  }

  /** Marca la sesión como consumida. Devuelve `false` si ya lo estaba. */
  public async markConsumed(sessionId: string): Promise<boolean> {
    try {
      const result = await this.pool.query<{ id: string }>(MARK_CONSUMED_SQL, [sessionId]);
      return result.rows.length > 0;
    } catch (err) {
      throw storageError(`consumir la sesión ${sessionId}`, err);
    }
  }

  /** Elimina las sesiones vencidas y no consumidas (barrido periódico, T071). */
  public async sweepExpired(): Promise<Count> {
    try {
      const result = await this.pool.query<{ id: string }>(SWEEP_EXPIRED_SQL);
      return result.rows.length;
    } catch (err) {
      throw storageError('barrer las sesiones vencidas', err);
    }
  }
}
