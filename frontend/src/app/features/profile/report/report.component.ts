import { Component, OnInit, computed, inject, signal } from '@angular/core';

import {
  EmptyStateComponent,
  ErrorStateComponent,
  LinkButtonComponent,
  SkeletonComponent,
} from '../../../shared/ui';
import { ProfileService } from '../profile.service';
import { ActivityReport } from '../profile.types';

type LoadState = 'loading' | 'ready' | 'error';

interface ReportStat {
  readonly label: string;
  /**
   * El valor tal como llega del borde. Se guarda como `number` y NO se toca: las cuatro
   * cifras del reporte son CONTEOS enteros (FR-014/FR-018), no montos, así que no cruzan
   * ninguna frontera decimal y no hay nada que preservar más allá de no manipularlas.
   */
  readonly value: number;
}

/**
 * Reporte estadístico de actividad (T148, FR-018; T057/T058, FR-113).
 *
 * LAS CIFRAS SON CONTEO, NO DINERO. `points`, `articles_viewed`, `quizzes_attempted` y
 * `simulations_run` son enteros del contrato (`int32`/`int64`), así que el Principio VIII
 * no entra aquí: no hay escala que perder. Lo que sí importa —y por eso las cifras van con
 * la tipografía de datos— es que se lean como datos y no como prosa (FR-113). Por eso este
 * componente NO hace ninguna operación con ellas: no suma, no promedia y no redondea; solo
 * las muestra.
 */
@Component({
  selector: 'fc-activity-report',
  standalone: true,
  imports: [EmptyStateComponent, ErrorStateComponent, LinkButtonComponent, SkeletonComponent],
  templateUrl: './report.component.html',
  styleUrl: './report.component.css',
})
export class ReportComponent implements OnInit {
  private readonly api = inject(ProfileService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly report = signal<ActivityReport | null>(null);

  protected readonly stats = computed<ReportStat[]>(() => {
    const report = this.report();
    if (report === null) {
      return [];
    }
    return [
      { label: 'Puntos acumulados', value: report.points },
      { label: 'Artículos vistos', value: report.articles_viewed },
      { label: 'Cuestionarios respondidos', value: report.quizzes_attempted },
      { label: 'Simulaciones ejecutadas', value: report.simulations_run },
    ];
  });

  /** Una cuenta recién creada tiene las cuatro cifras en cero (FR-119). */
  protected readonly isInactive = computed(() =>
    this.stats().every((stat) => stat.value === 0),
  );

  public ngOnInit(): void {
    this.load();
  }

  protected retry(): void {
    this.state.set('loading');
    this.load();
  }

  private load(): void {
    this.api.getActivityReport().subscribe({
      next: (report) => {
        this.report.set(report);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }
}
