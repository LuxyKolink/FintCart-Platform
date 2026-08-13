/**
 * Capa de TRANSPORTE del Servicio de Aprendizaje (Principio IX).
 *
 * Cinco responsabilidades y ninguna más: recibir el mensaje, extraer sus campos,
 * llamar al servicio de aplicación, convertir el resultado con `mapping.ts` y traducir
 * el error de dominio a un `RpcException` con su código gRPC.
 *
 * Lo que NO hace: no consulta la base, no valida reglas de negocio y no calcula nada.
 * Si aquí apareciera un `Decimal`, estaría en la capa equivocada.
 *
 * ## Los RPC que faltan
 *
 * `CreateDraft`, `UpdateDraft`, `SubmitForReview`, `ApproveAndPublish` y `Archive`
 * no se registran todavía: son el flujo editorial (US4). No declararlos es MEJOR
 * que declararlos devolviendo un error propio — gRPC responde `UNIMPLEMENTED` por
 * sí solo, que es exactamente lo que son, y un cliente puede distinguirlo de un
 * fallo del servidor.
 */
import { Controller } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';

import { ArticlesService } from '../articles/articles.service';
import { DomainError, messageOf } from '../common/errors';
import { DecimalStrError } from '../common/decimal-str';
import { GradingService } from '../grading/grading.service';
import { JsonLogger } from '../common/observability';
import { QuizzesService } from '../quizzes/quizzes.service';
import type { OpResult as OpResultPb } from '../pb/fintcart/common/v1/common';
import type {
  ArticleRef,
  Article as ArticlePb,
  GradeRequest,
  GradeResponse as GradeResponsePb,
  ListAttemptsRequest,
  ListAttemptsResponse as ListAttemptsResponsePb,
  ListPublishedRequest,
  ListPublishedResponse as ListPublishedResponsePb,
  QuizRef,
  Quiz as QuizPb,
  UserRef,
} from '../pb/fintcart/learning/v1/learning';

import { articleToPb, attemptsToPb, catalogToPb, gradeToPb, okResult, quizToPb } from './mapping';

/** Nombre del servicio en el contrato; debe coincidir con el `.proto`. */
const SERVICE = 'LearningService';

@Controller()
export class LearningController {
  private readonly logger = new JsonLogger();

  public constructor(
    private readonly articles: ArticlesService,
    private readonly quizzes: QuizzesService,
    private readonly grading: GradingService,
  ) {}

  /** Catálogo publicado por categoría (FR-010, SC-009). */
  @GrpcMethod(SERVICE, 'ListPublished')
  public async listPublished(request: ListPublishedRequest): Promise<ListPublishedResponsePb> {
    return this.guard('ListPublished', async () =>
      catalogToPb(await this.articles.listPublished(request.category ?? '', request.page)),
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

  /** Califica y persiste un intento (FR-012, FR-016). Lo invoca la Saga (D-07). */
  @GrpcMethod(SERVICE, 'GradeAndStoreAttempt')
  public async gradeAndStoreAttempt(request: GradeRequest): Promise<GradeResponsePb> {
    return this.guard('GradeAndStoreAttempt', async () =>
      gradeToPb(
        await this.grading.gradeAndStore(
          request.user_id ?? '',
          request.quiz_id ?? '',
          request.answers ?? {},
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

/**
 * Traduce el error de dominio al código de estado de gRPC.
 *
 * `DecimalStrError` se traduce aparte porque no es un `DomainError`: lo lanza la
 * frontera decimal cuando un valor almacenado o recibido no respeta la forma canónica.
 * Un `scale`/`range` es un dato que no cabe —culpa del emisor, `INVALID_ARGUMENT`—
 * mientras que un formato roto en un valor que salió de la base es corrupción de datos
 * y merece `INTERNAL`: el cliente no puede hacer nada al respecto.
 */
function codeOf(err: unknown): GrpcStatus {
  if (err instanceof DecimalStrError) {
    return err.code === 'scale' || err.code === 'range'
      ? GrpcStatus.INVALID_ARGUMENT
      : GrpcStatus.INTERNAL;
  }

  if (!(err instanceof DomainError)) {
    return GrpcStatus.INTERNAL;
  }

  switch (err.code) {
    case 'invalid_argument':
      return GrpcStatus.INVALID_ARGUMENT;
    case 'not_found':
      return GrpcStatus.NOT_FOUND;
    case 'conflict':
      return GrpcStatus.FAILED_PRECONDITION;
    case 'forbidden':
      return GrpcStatus.PERMISSION_DENIED;
    case 'not_implemented':
      return GrpcStatus.UNIMPLEMENTED;
    case 'storage':
      return GrpcStatus.INTERNAL;
  }
}

/**
 * Mensaje que SÍ puede ver el cliente.
 *
 * Un `storage` devuelve un texto fijo: su mensaje lleva la causa del driver, y ahí
 * aparecen nombres de constraint, de tabla y a veces valores de la fila que provocó el
 * conflicto. El detalle queda en el log, que es donde hace falta.
 */
function clientMessage(err: unknown): string {
  if (err instanceof DomainError && err.code !== 'storage') {
    return err.message;
  }
  if (err instanceof DecimalStrError && (err.code === 'scale' || err.code === 'range')) {
    return err.message;
  }
  return 'error interno';
}
