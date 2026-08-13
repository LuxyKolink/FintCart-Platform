/** DTOs de aprendizaje — espejo de `services/api-gateway/internal/handler/types.go`. */

export interface Article {
  article_id: string;
  title: string;
  category: string;
  body: string;
  current_version_no: number;
  quiz_ids: string[];
}

export interface Page<T> {
  items: T[];
  next_page_token?: string;
  total_size: number;
}

export interface Option {
  key: string;
  text: string;
}

export interface Question {
  question_id: string;
  prompt: string;
  options: Option[];
  /** Decimal canónico — usar `shared/decimal-str.ts` para leerlo. */
  weight: string;
}

export interface Quiz {
  quiz_id: string;
  article_id: string;
  title: string;
  /** Decimal canónico — usar `shared/decimal-str.ts` para leerlo. */
  pass_threshold: string;
  questions: Question[];
}

export interface SubmitAttemptRequest {
  answers: Record<string, string>;
}

/** `score` es `string` decimal canónico (Principio VIII) — nunca `number`. */
export interface QuizGradeResult {
  attempt_id: string;
  attempt_no: number;
  score: string;
  passed: boolean;
  points_after: number;
}
