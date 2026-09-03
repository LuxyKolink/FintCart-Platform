/** DTOs de aprendizaje — espejo de `services/api-gateway/internal/handler/types.go`. */

export interface Article {
  article_id: string;
  title: string;
  /** Nombre visible de la categoría (heredado de 001, conservado para no romper la tarjeta). */
  category: string;
  /** Referencia al catálogo de categorías (FR-034) — es el filtro preferente. */
  category_id: string;
  body: string;
  current_version_no: number;
  quiz_ids: string[];
}

/** Categoría del catálogo administrable (US1) — espejo del proto `learning.v1.Category`. */
export interface Category {
  category_id: string;
  name: string;
  slug: string;
  description: string;
  position: number;
  active: boolean;
}

/** Envoltorio de las listas `/catalog/categories` y `/admin/categories`. */
export interface CategoryCatalog {
  categories: Category[];
}

/** Cuerpo de alta/edición (`POST`/`PATCH /admin/categories`) — espejo de `CategoryInput`. */
export interface CategoryInput {
  name: string;
  slug?: string;
  description?: string;
  /** `≤ 0` en el alta anexa al final; en la edición deja el orden intacto. */
  position?: number;
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
