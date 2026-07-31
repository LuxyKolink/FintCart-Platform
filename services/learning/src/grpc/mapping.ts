/**
 * Mapeo explícito dominio ↔ protobuf (Principio IX regla 3).
 *
 * Este archivo es la ÚNICA frontera del servicio donde un `Decimal` se convierte en
 * `string` y viceversa. Concentrarlo aquí no es orden por el orden: si la conversión
 * estuviera repartida, bastaría un `String(score)` en un handler para que una
 * calificación saliera como `"85.5"` donde el contrato promete la forma canónica, o
 * peor, como `85.5` —un número JSON— violando el Principio VIII sin que nada avise.
 *
 * También es la frontera que garantiza la regla 1: los tipos generados de protobuf NO
 * entran en `articles/`, `quizzes/` ni `grading/`. Se convierten aquí y lo que viaja
 * hacia dentro son los tipos de dominio.
 */
import { format } from '../common/decimal-str';
import type { ArticleDetail, ArticleSummary } from '../articles/articles.repository';
import type { CatalogPage } from '../articles/articles.service';
import type { AttemptsPage, GradeResult } from '../grading/grading.service';
import type { Quiz, QuizQuestion } from '../quizzes/quizzes.repository';
import type {
  Article as ArticlePb,
  GradeResponse as GradeResponsePb,
  ListAttemptsResponse as ListAttemptsResponsePb,
  ListPublishedResponse as ListPublishedResponsePb,
  Question as QuestionPb,
  Quiz as QuizPb,
} from '../pb/fintcart/learning/v1/learning';

/**
 * Resumen del catálogo → `Article`.
 *
 * `body` sale VACÍO en el listado y con contenido en `GetArticle`. Es deliberado:
 * devolver el cuerpo completo de cada artículo en una página de veinte multiplicaría
 * por cien el tamaño de la respuesta para una vista que solo muestra títulos.
 */
function summaryToPb(article: ArticleSummary): ArticlePb {
  return {
    article_id: article.articleId,
    title: article.title,
    category: article.category,
    body: '',
    current_version_no: article.currentVersionNo,
    quiz_ids: [],
  };
}

/** Artículo completo → `Article`. */
export function articleToPb(article: ArticleDetail): ArticlePb {
  return {
    ...summaryToPb(article),
    body: article.body,
    quiz_ids: [...article.quizIds],
  };
}

/** Página del catálogo → `ListPublishedResponse`. */
export function catalogToPb(page: CatalogPage): ListPublishedResponsePb {
  return {
    items: page.items.map(summaryToPb),
    // `total_size` es `int64` y el generador lo emite como STRING (`forceLong=string`):
    // un `int64` por encima de 2^53 no cabe en un `number` de JavaScript, y dejarlo
    // pasar como número perdería el total exacto justo en los catálogos grandes.
    page: { next_page_token: page.nextPageToken, total_size: String(page.totalSize) },
  };
}

/**
 * Pregunta → `Question`.
 *
 * Las opciones salen con CLAVE y texto. El `key` es el que después llega de vuelta en
 * `GradeRequest.answers`; sin él, el cuestionario sería incontestable — que es
 * exactamente el defecto que corrigió el cambio de contrato de `Question.options`.
 *
 * La respuesta correcta no aparece aquí porque nunca llegó a este archivo: el
 * cuestionario que sirve el dominio no la contiene (ver `quizzes.repository.ts`).
 */
function questionToPb(question: QuizQuestion): QuestionPb {
  return {
    question_id: question.questionId,
    prompt: question.prompt,
    options: question.options.map((option) => ({ key: option.key, text: option.text })),
    weight: format(question.weight),
  };
}

/** Cuestionario → `Quiz`. */
export function quizToPb(quiz: Quiz): QuizPb {
  return {
    quiz_id: quiz.quizId,
    article_id: quiz.articleId,
    title: quiz.title,
    pass_threshold: format(quiz.passThreshold),
    questions: quiz.questions.map(questionToPb),
  };
}

/** Resultado de calificación → `GradeResponse`. */
export function gradeToPb(result: GradeResult): GradeResponsePb {
  return {
    attempt_id: result.attemptId,
    attempt_no: result.attemptNo,
    // `format` y no `toString()`: decimal.js pasa a notación exponencial en
    // `toString()` a partir de cierto tamaño, y `"1e+21"` rompería a cualquier
    // consumidor del contrato.
    score: format(result.score),
    passed: result.passed,
  };
}

/** Página del historial → `ListAttemptsResponse`. */
export function attemptsToPb(page: AttemptsPage): ListAttemptsResponsePb {
  return {
    items: page.items.map((attempt) => ({
      attempt_id: attempt.attemptId,
      attempt_no: attempt.attemptNo,
      score: format(attempt.score),
      created_at: attempt.createdAt,
    })),
    // `total_size` es `int64` y el generador lo emite como STRING (`forceLong=string`):
    // un `int64` por encima de 2^53 no cabe en un `number` de JavaScript, y dejarlo
    // pasar como número perdería el total exacto justo en los catálogos grandes.
    page: { next_page_token: page.nextPageToken, total_size: String(page.totalSize) },
  };
}
