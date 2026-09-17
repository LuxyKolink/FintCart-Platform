/**
 * Capa de TRANSPORTE del Servicio de Aprendizaje (Principio IX).
 *
 * Cinco responsabilidades y ninguna más: recibir el mensaje, extraer sus campos,
 * llamar al servicio de aplicación, convertir el resultado con `mapping.ts` y traducir
 * el error de dominio a un `RpcException` con su código gRPC.
 *
 * Lo que NO hace: no consulta la base, no valida reglas de negocio y no calcula nada.
 * Si aquí apareciera un `Decimal`, estaría en la capa equivocada.
 */
import { Controller } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';

import { ArticlesService } from '../articles/articles.service';
import { messageOf } from '../common/errors';
import { GradingService } from '../grading/grading.service';
import { clientMessage, codeOf } from '../common/rpc-errors';
import { JsonLogger } from '../common/observability';
import { PublishingService } from '../publishing/publishing.service';
import { QuizzesService } from '../quizzes/quizzes.service';
import { SessionService } from '../quizzes/session.service';
import type { OpResult as OpResultPb } from '../pb/fintcart/common/v1/common';
import type {
  ApprovePublishRequest,
  ArticleRef,
  Article as ArticlePb,
  ArticleVersion as ArticleVersionPb,
  CreateDraftRequest,
  GradeRequest,
  GradeResponse as GradeResponsePb,
  ListAttemptsRequest,
  ListAttemptsResponse as ListAttemptsResponsePb,
  ListPublishedRequest,
  ListPublishedResponse as ListPublishedResponsePb,
  ListVersionsRequest,
  ListVersionsResponse as ListVersionsResponsePb,
  QuizRef,
  Quiz as QuizPb,
  QuizSession as QuizSessionPb,
  StartQuizSessionRequest,
  UpdateDraftRequest,
  UpsertQuizRequest,
  UserRef,
  VersionRef,
} from '../pb/fintcart/learning/v1/learning';

import {
  articleToPb,
  attemptsToPb,
  catalogToPb,
  gradeToPb,
  okResult,
  parseBodyDoc,
  quizSessionToPb,
  quizToPb,
  versionToPb,
  versionsToPb,
} from './mapping';

/** Nombre del servicio en el contrato; debe coincidir con el `.proto`. */
const SERVICE = 'LearningService';

@Controller()
export class LearningController {
  private readonly logger = new JsonLogger();

  public constructor(
    private readonly articles: ArticlesService,
    private readonly quizzes: QuizzesService,
    private readonly grading: GradingService,
    private readonly publishing: PublishingService,
    private readonly sessions: SessionService,
  ) {}

  /** Catálogo publicado por categoría (FR-010, SC-009). `category_id` es el filtro
   * preferente de FR-034; `category` (nombre) se conserva para clientes antiguos. */
  @GrpcMethod(SERVICE, 'ListPublished')
  public async listPublished(request: ListPublishedRequest): Promise<ListPublishedResponsePb> {
    return this.guard('ListPublished', async () =>
      catalogToPb(
        await this.articles.listPublished(request.category_id ?? '', request.category ?? '', request.page),
      ),
    );
  }

  /** Artículo publicado; registra la vista (FR-011, FR-018, D-06). */
  @GrpcMethod(SERVICE, 'GetArticle')
  public async getArticle(request: ArticleRef): Promise<ArticlePb> {
    return this.guard('GetArticle', async () =>
      articleToPb(await this.articles.getArticle(request.article_id ?? '')),
    );
  }

  /** Cuestionario de un artículo (FR-009, FR-011). */
  @GrpcMethod(SERVICE, 'GetQuiz')
  public async getQuiz(request: QuizRef): Promise<QuizPb> {
    return this.guard('GetQuiz', async () =>
      quizToPb(await this.quizzes.getQuiz(request.quiz_id ?? '')),
    );
  }

  /** Sesión de intento (FR-038…FR-042): sustituye a `GetQuiz` como camino de ejecución. */
  @GrpcMethod(SERVICE, 'StartQuizSession')
  public async startQuizSession(request: StartQuizSessionRequest): Promise<QuizSessionPb> {
    return this.guard('StartQuizSession', async () =>
      quizSessionToPb(await this.sessions.startSession(request.user_id ?? '', request.quiz_id ?? '')),
    );
  }

  /** Califica y persiste un intento (FR-012, FR-016). Lo invoca la Saga (D-07). */
  @GrpcMethod(SERVICE, 'GradeAndStoreAttempt')
  public async gradeAndStoreAttempt(request: GradeRequest): Promise<GradeResponsePb> {
    return this.guard('GradeAndStoreAttempt', async () =>
      gradeToPb(
        await this.grading.gradeAndStore(
          request.user_id ?? '',
          request.quiz_id ?? '',
          request.session_id ?? '',
          request.answers ?? {},
          // proto3 no distingue «ausente» de «vacío»: sin clave, cada llamada
          // guarda un intento nuevo, como antes de T176.
          request.idempotency_key === undefined || request.idempotency_key === ''
            ? null
            : request.idempotency_key,
        ),
      ),
    );
  }

  /** Historial completo de intentos (FR-016, FR-029). */
  @GrpcMethod(SERVICE, 'ListAttempts')
  public async listAttempts(request: ListAttemptsRequest): Promise<ListAttemptsResponsePb> {
    return this.guard('ListAttempts', async () =>
      attemptsToPb(
        await this.grading.listAttempts(request.user_id ?? '', request.quiz_id ?? '', request.page),
      ),
    );
  }

  /** Paso de la Saga de anonimización (FR-030, D-08). Ver el comentario de
   * `GradingService.anonymizeAttempts` para por qué es un no-op deliberado. */
  @GrpcMethod(SERVICE, 'AnonymizeAttempts')
  public async anonymizeAttempts(request: UserRef): Promise<OpResultPb> {
    return this.guard('AnonymizeAttempts', async () => {
      await this.grading.anonymizeAttempts(request.user_id ?? '');
      return okResult();
    });
  }

  // ── Flujo editorial (US4, FR-007/FR-008/FR-013) ───────────────────────────

  /** Borrador nuevo, o nueva versión de un artículo existente (FR-007, FR-013). La
   * categoría se referencia por `category_id` (FR-034); `request.category` se ignora. */
  @GrpcMethod(SERVICE, 'CreateDraft')
  public async createDraft(request: CreateDraftRequest): Promise<ArticleVersionPb> {
    return this.guard('CreateDraft', async () =>
      versionToPb(
        await this.publishing.createDraft(
          request.title ?? '',
          request.category_id ?? '',
          request.body ?? '',
          request.editor_id ?? '',
          request.article_id ?? '',
          parseBodyDoc(request.body_doc),
        ),
      ),
    );
  }

  /** Edita el cuerpo de un borrador propio (FR-007). */
  @GrpcMethod(SERVICE, 'UpdateDraft')
  public async updateDraft(request: UpdateDraftRequest): Promise<ArticleVersionPb> {
    return this.guard('UpdateDraft', async () =>
      versionToPb(
        await this.publishing.updateDraft(
          request.version_id ?? '',
          request.editor_id ?? '',
          request.body ?? '',
          parseBodyDoc(request.body_doc),
        ),
      ),
    );
  }

  /** `borrador → en_revision` (FR-008). */
  @GrpcMethod(SERVICE, 'SubmitForReview')
  public async submitForReview(request: VersionRef): Promise<OpResultPb> {
    return this.guard('SubmitForReview', async () => {
      await this.publishing.submitForReview(request.version_id ?? '', request.actor_id ?? '');
      return okResult();
    });
  }

  /** `en_revision → publicado`, coordinador ≠ autor (FR-008). */
  @GrpcMethod(SERVICE, 'ApproveAndPublish')
  public async approveAndPublish(request: ApprovePublishRequest): Promise<OpResultPb> {
    return this.guard('ApproveAndPublish', async () => {
      await this.publishing.approveAndPublish(request.version_id ?? '', request.coordinator_id ?? '');
      return okResult();
    });
  }

  /** `publicado → archivado`. */
  @GrpcMethod(SERVICE, 'Archive')
  public async archive(request: VersionRef): Promise<OpResultPb> {
    return this.guard('Archive', async () => {
      await this.publishing.archive(request.version_id ?? '');
      return okResult();
    });
  }

  /** Historial de versiones, bandeja de revisión o borradores propios (FR-013). */
  @GrpcMethod(SERVICE, 'ListVersions')
  public async listVersions(request: ListVersionsRequest): Promise<ListVersionsResponsePb> {
    return this.guard('ListVersions', async () =>
      versionsToPb(
        await this.publishing.listVersions(
          {
            articleId: request.article_id ?? '',
            state: request.state ?? '',
            editorId: request.editor_id ?? '',
          },
          request.page,
        ),
      ),
    );
  }

  /** Reemplazo completo de un cuestionario (FR-009, T162). */
  @GrpcMethod(SERVICE, 'UpsertQuiz')
  public async upsertQuiz(request: UpsertQuizRequest): Promise<QuizPb> {
    return this.guard('UpsertQuiz', async () =>
      quizToPb(
        await this.quizzes.upsertQuiz(
          request.quiz_id ?? '',
          request.article_id ?? '',
          request.title ?? '',
          request.pass_threshold ?? '',
          (request.questions ?? []).map((q) => ({
            prompt: q.prompt ?? '',
            options: q.options ?? {},
            correctKey: q.correct_key ?? '',
            weight: q.weight ?? '',
          })),
          request.questions_to_serve ?? 0,
        ),
      ),
    );
  }

  /**
   * Ejecuta el handler traduciendo cualquier error de dominio a un estado gRPC.
   *
   * La traducción vive en UN sitio a propósito. Repartida por los handlers, cada uno
   * acabaría eligiendo su propio código para el mismo `not_found`, y un cliente que
   * reintenta según el código recibiría respuestas incoherentes para el mismo fallo.
   */
  private async guard<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      // El mensaje completo va al LOG; lo que sale al cliente está saneado. Un error
      // de `pg` lleva dentro nombres de tabla y fragmentos de SQL, y un servicio
      // interno no debería enseñar su esquema ni siquiera a otro servicio interno.
      this.logger.error(`${operation} falló: ${messageOf(err)}`, operation);
      throw new RpcException({ code: codeOf(err), message: clientMessage(err) });
    }
  }
}
