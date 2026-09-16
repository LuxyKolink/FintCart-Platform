import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import {
  BadgeComponent,
  type BadgeTone,
  CardComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  LinkButtonComponent,
  ModuleBoxComponent,
  ProgressBarComponent,
  SkeletonComponent,
} from '../../../shared/ui';
import { ProfileService } from '../../profile/profile.service';
import { ActivityReport, QuizAttempt } from '../../profile/profile.types';
import { formatScore as formatScoreText, isGoodScore } from '../../../shared/format-decimal';
import { currentMilestone, nextMilestone, withinMilestone } from './milestones';
import { ProgressApiService } from './progress-api.service';
import { PointsCount, Progress } from './progress.types';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Pantalla de progreso (FR-105, T035).
 *
 * ─── POR QUÉ AQUÍ SOLO HAY UN `.fc-num` ────────────────────────────────────────
 *
 * `us1-aprendizaje.spec.ts` cierra su recorrido con
 * `expect(page.locator('.fc-num')).toHaveText(/\d+ puntos/)`, y esa aserción se
 * resuelve contra UN elemento: si la pantalla tuviera un segundo `.fc-num` —una
 * estadística, un puntaje del historial—, Playwright fallaría por ambigüedad aunque la
 * pantalla fuese correcta. La suite NO se toca (nota N-13), así que la figura con
 * tipografía de datos es la de los puntos y los contadores secundarios van con la
 * tipografía normal. Se gana además en jerarquía: una cifra protagonista, no cinco.
 *
 * Ojo con la trampa: `fc-progress-bar` pinta su propio `.fc-num` cuando se le pide
 * `showValue`, así que en esta pantalla no se le pide (el valor va en el texto del
 * hito). Ver la nota de T035 en `tasks.md`.
 *
 * ─── TRES FUENTES, TRES ESTADOS ────────────────────────────────────────────────
 *
 * Los puntos, las estadísticas y el historial vienen de endpoints distintos
 * (`/me/progress`, `/me/report` y `/me/data`). Cada zona declara su carga y su error
 * por separado (FR-118): que el historial falle no puede ocultar los puntos, que es lo
 * único que el usuario vino a ver.
 */
@Component({
  selector: 'fc-progress',
  standalone: true,
  imports: [
    DatePipe,
    BadgeComponent,
      LinkButtonComponent,
    CardComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    ModuleBoxComponent,
    ProgressBarComponent,
    SkeletonComponent,
  ],
  templateUrl: './progress.component.html',
  styleUrl: './progress.component.css',
})
export class ProgressComponent implements OnInit {
  private readonly api = inject(ProgressApiService);
  private readonly profileApi = inject(ProfileService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly progress = signal<Progress | null>(null);

  protected readonly reportState = signal<LoadState>('loading');
  protected readonly report = signal<ActivityReport | null>(null);

  protected readonly historyState = signal<LoadState>('loading');
  protected readonly history = signal<QuizAttempt[]>([]);

  /** Los intentos se muestran del más reciente al más antiguo. */
  protected readonly recentAttempts = computed<QuizAttempt[]>(() => [...this.history()].reverse());

  public ngOnInit(): void {
    this.loadProgress();
    this.loadReport();
    this.loadHistory();
  }

  /** Progreso dentro del hito de 100 puntos actual, como banda visual (0–100). */
  protected withinMilestone(points: PointsCount): PointsCount {
    return withinMilestone(points);
  }

  protected currentMilestone(points: PointsCount): PointsCount {
    return currentMilestone(points);
  }

  protected nextMilestone(points: PointsCount): PointsCount {
    return nextMilestone(points);
  }

  /**
   * Puntaje del historial (FR-109 / T040). Pasa por el ayudante de frontera, que
   * conserva la escala: `"85.15"` se sigue leyendo 85.15 y no 85. Truncar aquí sería
   * mostrar una calificación distinta de la registrada (Principio VIII, N-15).
   */
  protected formatScore(score: string): string {
    return formatScoreText(score);
  }

  protected scoreTone(score: string): BadgeTone {
    return isGoodScore(score) ? 'success' : 'neutral';
  }

  protected retryProgress(): void {
    this.loadProgress();
  }

  protected retryReport(): void {
    this.loadReport();
  }

  protected retryHistory(): void {
    this.loadHistory();
  }

  private loadProgress(): void {
    this.state.set('loading');
    this.api.getProgress().subscribe({
      next: (progress) => {
        this.progress.set(progress);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  private loadReport(): void {
    this.reportState.set('loading');
    this.profileApi.getActivityReport().subscribe({
      next: (report) => {
        this.report.set(report);
        this.reportState.set('ready');
      },
      error: () => this.reportState.set('error'),
    });
  }

  private loadHistory(): void {
    this.historyState.set('loading');
    this.profileApi.getPersonalData().subscribe({
      next: (data) => {
        this.history.set(data.quiz_attempts.items);
        this.historyState.set('ready');
      },
      error: () => this.historyState.set('error'),
    });
  }
}
