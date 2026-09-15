/** DTOs del flujo editorial — espejo de `services/api-gateway/internal/handler/types.go`. */
import { Page } from '../simulators/simulators.types';

export type { Page };

/** `borrador | en_revision | publicado | archivado` (FR-008). */
export type VersionState = 'borrador' | 'en_revision' | 'publicado' | 'archivado';

export interface ArticleVersion {
  version_id: string;
  article_id: string;
  version_no: number;
  state: VersionState;
  created_by: string;
  approved_by?: string;
  created_at: string;
  published_at?: string;
  body?: string;
}

export interface CreateDraftRequest {
  title: string;
  /** Referencia al catálogo (FR-034) — se escoge del desplegable, no a mano. */
  category_id: string;
  body: string;
}

export interface UpdateDraftRequest {
  body: string;
}

export interface QuestionInput {
  prompt: string;
  options: Record<string, string>;
  correct_key: string;
  /** Decimal canónico — usar `shared/decimal-str.ts` para validarlo. */
  weight: string;
}

export interface UpsertQuizRequest {
  article_id?: string;
  title: string;
  /** Decimal canónico. */
  pass_threshold: string;
  /**
   * Cuántas preguntas sortea cada intento (FR-037). El Gateway lo omite del JSON si va
   * a 0 y lo resuelve a 5, así que desde aquí SIEMPRE debe viajar un entero > 0.
   */
  questions_to_serve: number;
  questions: QuestionInput[];
}

export interface Option {
  key: string;
  text: string;
}

export interface Question {
  question_id: string;
  prompt: string;
  options: Option[];
  weight: string;
}

export interface Quiz {
  quiz_id: string;
  article_id: string;
  title: string;
  pass_threshold: string;
  /** Preguntas sorteadas por intento (FR-037) — se precarga al reabrir el cuestionario. */
  questions_to_serve: number;
  questions: Question[];
}

export interface OpAck {
  success: boolean;
  code?: string;
  message?: string;
}

export interface ListVersionsFilter {
  article_id?: string;
  state?: VersionState | '';
  editor_id?: string;
  page_token?: string;
}
