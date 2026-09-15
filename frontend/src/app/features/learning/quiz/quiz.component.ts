import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import * as decimalStr from '../../../shared/decimal-str';
import { LearningApiService } from '../learning-api.service';
import { QuizGradeResult, QuizSession } from '../learning.types';
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
  protected readonly session = signal<QuizSession | null>(null);
  protected readonly answers = signal<Record<string, string>>({});
  protected readonly resumedFromDraft = signal(false);

  protected readonly submitState = signal<SubmitState>('idle');
  /** La sesión venció o ya se consumió (409, FR-042): reintentar no la arregla. */
  protected readonly sessionGone = signal(false);
  protected readonly result = signal<QuizGradeResult | null>(null);

  private quizId = '';

  public ngOnInit(): void {
    this.quizId = this.route.snapshot.paramMap.get('quizId') ?? '';
    this.openSession();
  }

  /**
   * Abre un intento. Desde US2 el cuestionario NO se lee (`GetQuiz`) sino que se abre
   * una SESIÓN: el servidor sortea las preguntas y baraja las opciones, así que la
   * pantalla solo puede pintar lo que esa sesión sirvió.
   */
  private openSession(): void {
    this.state.set('loading');
    this.api.startQuizSession(this.quizId).subscribe({
      next: (session) => {
        this.session.set(session);
        this.resumeDraft(session);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  /**
   * Reanuda el borrador local (001 Edge Case) acotándolo a lo que esta sesión sirvió.
   *
   * El filtro NO es cosmético: como cada sesión sortea un subconjunto distinto, un
   * borrador guardado contra una sesión anterior puede referirse a preguntas que esta
   * no sirvió, y enviarlas haría que el servidor rechazara el intento entero (FR-040).
   * Se conservan las respuestas que sí coinciden; las demás se descartan en silencio.
   */
  private resumeDraft(session: QuizSession): void {
    const draft = this.quizState.loadDraft(this.quizId);
    if (draft === null) {
      return;
    }
    const served = new Set(session.questions.map((question) => question.question_id));
    const applicable = Object.fromEntries(
      Object.entries(draft).filter(([questionId]) => served.has(questionId)),
    );
    if (Object.keys(applicable).length > 0) {
      this.answers.set(applicable);
      this.resumedFromDraft.set(true);
    }
  }

  protected setAnswer(questionId: string, optionKey: string): void {
    const next = { ...this.answers(), [questionId]: optionKey };
    this.answers.set(next);
    this.quizState.saveDraft(this.quizId, next);
  }

  /**
   * Empieza de nuevo: abre una sesión NUEVA en vez de reusar la actual.
   *
   * Reusarla no serviría de nada —el sorteo ya está fijado y, si la sesión venció o se
   * consumió, seguiría siéndolo—, y descartar el borrador es coherente con que las
   * preguntas van a ser otras.
   */
  protected restart(): void {
    this.answers.set({});
    this.resumedFromDraft.set(false);
    this.sessionGone.set(false);
    this.submitState.set('idle');
    this.quizState.clearDraft(this.quizId);
    this.openSession();
  }

  protected get allAnswered(): boolean {
    const session = this.session();
    if (session === null) {
      return false;
    }
    return session.questions.every((q) => this.answers()[q.question_id] !== undefined);
  }

  protected formatScore(score: string): string {
    return decimalStr.format(decimalStr.parseScore(score));
  }

  protected onSubmit(): void {
    const session = this.session();
    if (session === null || !this.allAnswered || this.submitState() === 'submitting') {
      return;
    }
    this.submitState.set('submitting');
    this.sessionGone.set(false);

    this.api
      .submitQuizAttempt(this.quizId, { session_id: session.session_id, answers: this.answers() })
      .subscribe({
        next: (gradeResult) => {
          this.submitState.set('idle');
          this.result.set(gradeResult);
          // Solo ahora hay un intento registrado en el servidor: el borrador local deja
          // de tener sentido y limpiarlo evita ofrecer "reanudar" un cuestionario ya
          // calificado.
          this.quizState.clearDraft(this.quizId);
        },
        error: (err: unknown) => {
          // 409 = la sesión venció o ya se consumió (FR-042). No es un fallo de red:
          // conservar el borrador y ofrecer "reintentar" condenaría al usuario a un
          // bucle, porque ese `session_id` ya no califica nunca.
          if (err instanceof HttpErrorResponse && err.status === 409) {
            this.sessionGone.set(true);
            this.submitState.set('idle');
            return;
          }
          // La conexión pudo caerse a mitad del envío (Edge Cases, spec.md): el borrador
          // se conserva a propósito para poder reintentar sin perder las respuestas.
          this.submitState.set('error');
        },
      });
  }
}
