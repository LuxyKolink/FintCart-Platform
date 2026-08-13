import { Component, OnInit, inject, signal } from '@angular/core';

import { ProgressApiService } from './progress-api.service';
import { PointsCount, Progress } from './progress.types';

type LoadState = 'loading' | 'ready' | 'error';

const MILESTONE = 100;

@Component({
  selector: 'fc-progress',
  standalone: true,
  templateUrl: './progress.component.html',
})
export class ProgressComponent implements OnInit {
  private readonly api = inject(ProgressApiService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly progress = signal<Progress | null>(null);

  public ngOnInit(): void {
    this.api.getProgress().subscribe({
      next: (progress) => {
        this.progress.set(progress);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  /** Progreso dentro del hito de 100 puntos actual, como banda visual (0–100). */
  protected withinMilestone(points: PointsCount): PointsCount {
    return points % MILESTONE;
  }

  protected currentMilestone(points: PointsCount): PointsCount {
    return Math.floor(points / MILESTONE) * MILESTONE;
  }

  protected nextMilestone(points: PointsCount): PointsCount {
    return this.currentMilestone(points) + MILESTONE;
  }
}
