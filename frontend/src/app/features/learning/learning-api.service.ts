import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Article, Category, CategoryCatalog, Page, QuizGradeResult, QuizSession, SubmitAttemptRequest } from './learning.types';

@Injectable({ providedIn: 'root' })
export class LearningApiService {
  private readonly http = inject(HttpClient);

  /** Filtra el catálogo público por `category_id` (FR-034) — vacío ⇒ sin filtrar. */
  public listArticles(categoryId?: string): Observable<Page<Article>> {
    let params = new HttpParams();
    if (categoryId) {
      params = params.set('category_id', categoryId);
    }
    return this.http.get<Page<Article>>(`${environment.apiBaseUrl}/catalog/articles`, { params });
  }

  /** Categorías ACTIVAS (US1): alimenta el desplegable del editor y el filtro público. */
  public listCategories(): Observable<Category[]> {
    return this.http
      .get<CategoryCatalog>(`${environment.apiBaseUrl}/catalog/categories`)
      .pipe(map((catalog) => catalog.categories));
  }

  public getArticle(articleId: string): Observable<Article> {
    return this.http.get<Article>(`${environment.apiBaseUrl}/catalog/articles/${articleId}`);
  }

  /**
   * Abre un intento (US2, FR-038): el servidor sortea `questions_to_serve` preguntas del
   * banco y baraja sus opciones. Sustituye a `GetQuiz` como camino de ejecución —
   * `GET /quizzes/{quizId}` sigue existiendo en el contrato, pero ya no es por donde se
   * rinde un cuestionario.
   *
   * El cuerpo va vacío a propósito: quién es el usuario sale del token y cuántas
   * preguntas se sirven es configuración del cuestionario, no elección del lector.
   */
  public startQuizSession(quizId: string): Observable<QuizSession> {
    return this.http.post<QuizSession>(`${environment.apiBaseUrl}/quizzes/${quizId}/session`, {});
  }

  public submitQuizAttempt(quizId: string, body: SubmitAttemptRequest): Observable<QuizGradeResult> {
    return this.http.post<QuizGradeResult>(`${environment.apiBaseUrl}/quizzes/${quizId}/attempts`, body);
  }
}
