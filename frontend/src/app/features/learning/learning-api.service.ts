import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Article, Page, Quiz, QuizGradeResult, SubmitAttemptRequest } from './learning.types';

@Injectable({ providedIn: 'root' })
export class LearningApiService {
  private readonly http = inject(HttpClient);

  public listArticles(category?: string): Observable<Page<Article>> {
    let params = new HttpParams();
    if (category) {
      params = params.set('category', category);
    }
    return this.http.get<Page<Article>>(`${environment.apiBaseUrl}/catalog/articles`, { params });
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
