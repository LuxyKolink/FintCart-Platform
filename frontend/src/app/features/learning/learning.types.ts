/** DTOs de aprendizaje — espejo de `services/api-gateway/internal/handler/types.go`. */

export interface Article {
  article_id: string;
  title: string;
  /** Nombre visible de la categoría (heredado de 001, conservado para no romper la tarjeta). */
  category: string;
  /** Referencia al catálogo de categorías (FR-034) — es el filtro preferente. */
  category_id: string;
  body: string;
  /**
   * Documento de bloques de la versión publicada (FR-063, research D-14), tal cual lo
   * entrega el borde: un objeto JSON. **Ausente** en los artículos publicados antes de
   * que existiera el documento de bloques — y ese caso no es hipotético, hay versiones
   * publicadas así—, y entonces el lector cae a `body`.
   *
   * El tipo es `unknown` a propósito: el cliente NO decide aquí que esto es un
   * documento. Lo que llega por la red se comprueba antes de usarlo (`body-doc.ts
   * ::parseBodyDoc`), porque un `as BodyDocNode` sobre una respuesta HTTP es una
   * promesa que nadie firmó.
   */
  body_doc?: unknown;
  current_version_no: number;
  /**
   * Cuestionarios del artículo (FR-009). Puede llegar `null` o ausente —un artículo sin
   * cuestionario es lo normal— y quien lo consuma tiene que tratarlo como lista vacía.
   */
  quiz_ids?: string[] | null;
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

/**
 * Intento abierto (`POST /quizzes/{quizId}/session`, FR-038) — espejo de `QuizSession`
 * de `services/api-gateway/internal/handler/types.go`.
 *
 * Sustituye a `Quiz` como camino de ejecución: las preguntas ya vienen **sorteadas**
 * del banco y con las opciones **barajadas**, así que este objeto solo vale para ESTE
 * intento. Al vencer `expires_at` deja de poder calificarse (FR-042).
 */
export interface QuizSession {
  session_id: string;
  quiz_id: string;
  title: string;
  /** Decimal canónico — usar `shared/decimal-str.ts` para leerlo. */
  pass_threshold: string;
  /** RFC-3339. */
  expires_at: string;
  /** Exactamente `questions_to_serve`, o todas las del banco si tiene menos (FR-038). */
  questions: Question[];
}

export interface SubmitAttemptRequest {
  /** Obligatorio desde US2: sin sesión el servidor no califica (FR-040). */
  session_id: string;
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
