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
import { invalidArgument } from '../common/errors';
import type { Category } from '../categories/category.types';
import type { OpResult as OpResultPb } from '../pb/fintcart/common/v1/common';
import type { ArticleDetail, ArticleSummary } from '../articles/articles.repository';
import type { CatalogPage } from '../articles/articles.service';
import type { AttemptsPage, GradeResult } from '../grading/grading.service';
import type { VersionsPage } from '../publishing/publishing.service';
import type { VersionRow } from '../publishing/publishing.repository';
import type { BodyDocNode } from '../articles/body-doc';
import type { Quiz, QuizQuestion } from '../quizzes/quizzes.repository';
import type { StartedSession } from '../quizzes/session.service';
import type {
  Article as ArticlePb,
  ArticleVersion as ArticleVersionPb,
  Category as CategoryPb,
  GradeResponse as GradeResponsePb,
  ListAttemptsResponse as ListAttemptsResponsePb,
  ListPublishedResponse as ListPublishedResponsePb,
  ListVersionsResponse as ListVersionsResponsePb,
  Question as QuestionPb,
  Quiz as QuizPb,
  QuizSession as QuizSessionPb,
} from '../pb/fintcart/learning/v1/learning';

/**
 * Respuesta de éxito de las operaciones de comando.
 *
 * Un FALLO no viaja como `success: false`: viaja como `RpcException` (ver
 * `learning.controller.ts::guard`), para que el cliente no tenga dos caminos
 * distintos que comprobar y se olvide de uno.
 */
export function okResult(): OpResultPb {
  return { success: true, code: '', message: '' };
}

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
    category_id: article.categoryId,
    // El listado NO lleva documento, por el mismo motivo por el que no lleva cuerpo:
    // una página de veinte artículos con sus árboles de bloques multiplicaría el
    // tamaño de la respuesta para una vista que solo muestra títulos.
    body_doc: '',
  };
}

/**
 * Categoría de dominio → `Category`.
 *
 * `position` es un `int32` en el contrato y un cardinal de orden en el dominio: puede
 * viajar como `number` sin violar el Principio VIII, que prohíbe `number` solo para
 * valores decimales con escala.
 */
export function categoryToPb(category: Category): CategoryPb {
  return {
    category_id: category.categoryId,
    name: category.name,
    slug: category.slug,
    description: category.description,
    position: category.position,
    active: category.active,
  };
}

/** Artículo completo → `Article`. */
export function articleToPb(article: ArticleDetail): ArticlePb {
  return {
    ...summaryToPb(article),
    body: article.body,
    body_doc: serializeBodyDoc(article.bodyDoc),
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
    questions_to_serve: quiz.questionsToServe,
  };
}

/** Sesión de intento → `QuizSession`. Las preguntas ya van servidas y barajadas. */
export function quizSessionToPb(session: StartedSession): QuizSessionPb {
  return {
    session_id: session.sessionId,
    quiz_id: session.quizId,
    title: session.title,
    pass_threshold: format(session.passThreshold),
    expires_at: session.expiresAt,
    questions: session.questions.map(questionToPb),
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
    session_id: result.sessionId,
  };
}

/**
 * Documento de bloques → texto del contrato (FR-063).
 *
 * El documento viaja como JSON serializado, no como mensaje anidado, para que el
 * vocabulario cerrado se valide en un solo sitio (ver la cabecera de este campo en
 * `learning.proto`). Aquí solo se serializa lo que YA está guardado y validado: no se
 * valida al salir, porque un documento inválido en la base es un fallo de la capa de
 * escritura, no algo que el lector deba descubrir y arreglar.
 *
 * `null` sale como cadena vacía: el contrato no tiene nulos, y un cliente que reciba
 * `""` sabe que tiene que caer a `body`. Inventar aquí un documento vacío sería peor:
 * diría «esta versión tiene un cuerpo sin bloques» cuando en realidad es «esta versión
 * es anterior al documento de bloques».
 */
/**
 * `body_doc` tal como llega en la petición → valor para el servicio (T131).
 *
 * Es una conversión PURA de transporte y por eso vive aquí: el contrato declara el campo
 * como una CADENA que contiene JSON —decisión documentada en `learning.proto`, para que el
 * borde transporte el documento sin interpretarlo y el vocabulario cerrado se valide en un
 * solo lugar—, así que alguien tiene que analizarla. Quién decide si el documento es
 * válido es `PublishingService`: aquí no se mira ni un nodo.
 *
 * Una cadena vacía significa «no lo mandaron» y un JSON ilegible significa que el cliente
 * mandó basura: el primero acaba en `null` (cuerpo heredado) y el segundo en un
 * `invalid_argument` explícito, porque devolver `null` en silencio convertiría un error del
 * cliente en un cuerpo vacío guardado como si fuera intención suya.
 */
export function parseBodyDoc(raw: string | undefined): unknown | null {
  const texto = (raw ?? '').trim();
  if (texto === '') {
    return null;
  }
  try {
    return JSON.parse(texto) as unknown;
  } catch (err) {
    throw invalidArgument('body_doc no es JSON legible', err);
  }
}

function serializeBodyDoc(doc: BodyDocNode | null): string {
  return doc === null ? '' : JSON.stringify(doc);
}

/** Versión → `ArticleVersion`. */
export function versionToPb(version: VersionRow): ArticleVersionPb {
  return {
    version_id: version.versionId,
    article_id: version.articleId,
    version_no: version.versionNo,
    state: version.state,
    created_by: version.createdBy,
    approved_by: version.approvedBy,
    created_at: version.createdAt,
    published_at: version.publishedAt,
    body: version.body,
    body_doc: serializeBodyDoc(version.bodyDoc),
  };
}

/** Página de versiones → `ListVersionsResponse`. */
export function versionsToPb(page: VersionsPage): ListVersionsResponsePb {
  return {
    items: page.items.map(versionToPb),
    page: { next_page_token: page.nextPageToken, total_size: String(page.totalSize) },
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
      served_question_ids: [...attempt.servedQuestionIds],
    })),
    // `total_size` es `int64` y el generador lo emite como STRING (`forceLong=string`):
    // un `int64` por encima de 2^53 no cabe en un `number` de JavaScript, y dejarlo
    // pasar como número perdería el total exacto justo en los catálogos grandes.
    page: { next_page_token: page.nextPageToken, total_size: String(page.totalSize) },
  };
}
