import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  ArticleVersion,
  CreateDraftRequest,
  ListVersionsFilter,
  OpAck,
  Page,
  Quiz,
  UpdateDraftRequest,
  UpsertQuizRequest,
} from './editorial.types';

export type EditorialErrorKind = 'offline' | 'forbidden' | 'invalid' | 'server';

/**
 * Error clasificado de una llamada editorial (US4, T167–T169). Mismo mecanismo que
 * `ProfileError`/`SimulationError`: el llamador decide el mensaje según `kind`, y el
 * formulario NUNCA se limpia ante un error.
 *
 * `forbidden` es propio de este servicio y no de los otros dos: es el desenlace de que
 * un editor intente aprobar/publicar su propio artículo (FR-008) — un caso que merece
 * un mensaje distinto de «revisa los datos», porque el dato no es el problema.
 */
export class EditorialError extends Error {
  public readonly kind: EditorialErrorKind;

  public constructor(kind: EditorialErrorKind, message: string) {
    super(message);
    this.name = 'EditorialError';
    this.kind = kind;
  }
}

@Injectable({ providedIn: 'root' })
export class EditorialApiService {
  private readonly http = inject(HttpClient);

  public createArticle(body: CreateDraftRequest): Observable<ArticleVersion> {
    return this.request(this.http.post<ArticleVersion>(`${environment.apiBaseUrl}/editorial/articles`, body));
  }

  public createVersion(articleId: string, body: UpdateDraftRequest): Observable<ArticleVersion> {
    return this.request(
      this.http.post<ArticleVersion>(`${environment.apiBaseUrl}/editorial/articles/${articleId}/versions`, body),
    );
  }

  public updateDraft(versionId: string, body: UpdateDraftRequest): Observable<ArticleVersion> {
    return this.request(
      this.http.patch<ArticleVersion>(`${environment.apiBaseUrl}/editorial/versions/${versionId}`, body),
    );
  }

  public submitForReview(versionId: string): Observable<OpAck> {
    return this.request(
      this.http.post<OpAck>(`${environment.apiBaseUrl}/editorial/versions/${versionId}/submit`, {}),
    );
  }

  public approveAndPublish(versionId: string): Observable<OpAck> {
    return this.request(
      this.http.post<OpAck>(`${environment.apiBaseUrl}/editorial/versions/${versionId}/publish`, {}),
    );
  }

  public archive(versionId: string): Observable<OpAck> {
    return this.request(
      this.http.post<OpAck>(`${environment.apiBaseUrl}/editorial/versions/${versionId}/archive`, {}),
    );
  }

  public listVersions(filter: ListVersionsFilter): Observable<Page<ArticleVersion>> {
    let params = new HttpParams();
    if (filter.article_id) {
      params = params.set('article_id', filter.article_id);
    }
    if (filter.state) {
      params = params.set('state', filter.state);
    }
    if (filter.editor_id) {
      params = params.set('editor_id', filter.editor_id);
    }
    if (filter.page_token) {
      params = params.set('page_token', filter.page_token);
    }
    return this.request(this.http.get<Page<ArticleVersion>>(`${environment.apiBaseUrl}/editorial/versions`, { params }));
  }

  public createQuiz(body: UpsertQuizRequest): Observable<Quiz> {
    return this.request(this.http.post<Quiz>(`${environment.apiBaseUrl}/editorial/quizzes`, body));
  }

  public updateQuiz(quizId: string, body: UpsertQuizRequest): Observable<Quiz> {
    return this.request(this.http.put<Quiz>(`${environment.apiBaseUrl}/editorial/quizzes/${quizId}`, body));
  }

  private request<T>(source: Observable<T>): Observable<T> {
    return source.pipe(catchError((err: unknown) => throwError(() => this.classify(err))));
  }

  private classify(err: unknown): EditorialError {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return new EditorialError(
          'offline',
          'Parece que perdiste la conexión. Tus datos siguen aquí — intenta de nuevo.',
        );
      }
      if (err.status === 403) {
        return new EditorialError(
          'forbidden',
          'Un coordinador editorial no puede aprobar ni publicar su propio artículo.',
        );
      }
      if (err.status >= 400 && err.status < 500) {
        return new EditorialError('invalid', 'Revisa los datos ingresados e intenta de nuevo.');
      }
    }
    return new EditorialError('server', 'No pudimos completar la operación. Intenta de nuevo.');
  }
}
