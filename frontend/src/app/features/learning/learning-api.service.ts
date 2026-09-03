import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Article, Category, CategoryCatalog, Page, Quiz, QuizGradeResult, SubmitAttemptRequest } from './learning.types';

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

  public getQuiz(quizId: string): Observable<Quiz> {
    return this.http.get<Quiz>(`${environment.apiBaseUrl}/quizzes/${quizId}`);
  }

  public submitQuizAttempt(quizId: string, body: SubmitAttemptRequest): Observable<QuizGradeResult> {
    return this.http.post<QuizGradeResult>(`${environment.apiBaseUrl}/quizzes/${quizId}/attempts`, body);
  }
}
