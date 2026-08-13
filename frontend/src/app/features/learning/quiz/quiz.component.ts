import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import * as decimalStr from '../../../shared/decimal-str';
import { LearningApiService } from '../learning-api.service';
import { Quiz, QuizGradeResult } from '../learning.types';
import { QuizStateService } from './quiz-state.service';

type LoadState = 'loading' | 'ready' | 'error';
type SubmitState = 'idle' | 'submitting' | 'error';

@Component({
  selector: 'fc-quiz',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './quiz.component.html',
})
export class QuizComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(LearningApiService);
  private readonly quizState = inject(QuizStateService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly quiz = signal<Quiz | null>(null);
  protected readonly answers = signal<Record<string, string>>({});
  protected readonly resumedFromDraft = signal(false);

  protected readonly submitState = signal<SubmitState>('idle');
  protected readonly result = signal<QuizGradeResult | null>(null);

  private quizId = '';

  public ngOnInit(): void {
    this.quizId = this.route.snapshot.paramMap.get('quizId') ?? '';
    this.api.getQuiz(this.quizId).subscribe({
      next: (quiz) => {
        this.quiz.set(quiz);
        const draft = this.quizState.loadDraft(this.quizId);
        if (draft !== null) {
          this.answers.set(draft);
          this.resumedFromDraft.set(true);
        }
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected setAnswer(questionId: string, optionKey: string): void {
    const next = { ...this.answers(), [questionId]: optionKey };
    this.answers.set(next);
    this.quizState.saveDraft(this.quizId, next);
  }

  protected restart(): void {
    this.answers.set({});
    this.resumedFromDraft.set(false);
    this.quizState.clearDraft(this.quizId);
  }

  protected get allAnswered(): boolean {
    const quiz = this.quiz();
    if (quiz === null) {
      return false;
    }
    return quiz.questions.every((q) => this.answers()[q.question_id] !== undefined);
  }

  protected formatScore(score: string): string {
    return decimalStr.format(decimalStr.parseScore(score));
  }

  protected onSubmit(): void {
    if (!this.allAnswered || this.submitState() === 'submitting') {
      return;
    }
    this.submitState.set('submitting');
    this.api.submitQuizAttempt(this.quizId, { answers: this.answers() }).subscribe({
      next: (gradeResult) => {
        this.submitState.set('idle');
        this.result.set(gradeResult);
        // Solo ahora hay un intento registrado en el servidor: el borrador local deja
        // de tener sentido y limpiarlo evita ofrecer "reanudar" un cuestionario ya
        // calificado.
        this.quizState.clearDraft(this.quizId);
      },
      error: () => {
        // La conexión pudo caerse a mitad del envío (Edge Cases, spec.md): el borrador
        // se conserva a propósito para poder reintentar sin perder las respuestas.
        this.submitState.set('error');
      },
    });
  }
}
