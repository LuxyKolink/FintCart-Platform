import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ProfileService } from '../profile.service';
import { ActivityReport } from '../profile.types';

type LoadState = 'loading' | 'ready' | 'error';

/** Reporte estadístico de actividad (T148, FR-018). */
@Component({
  selector: 'fc-activity-report',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './report.component.html',
})
export class ReportComponent implements OnInit {
  private readonly api = inject(ProfileService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly report = signal<ActivityReport | null>(null);

  public ngOnInit(): void {
    this.api.getActivityReport().subscribe({
      next: (report) => {
        this.report.set(report);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }
}
