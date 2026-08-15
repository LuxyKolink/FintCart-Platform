import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';

import { EditorialApiService, EditorialError } from '../editorial-api.service';
import { ArticleVersion } from '../editorial.types';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Bandeja de revisión del coordinador editorial (T168, FR-008).
 *
 * Lista las versiones en `en_revision` de CUALQUIER editor — a diferencia de "Mis
 * borradores" de `VersionsComponent`, esta vista no filtra por `editor_id`. Aprobar
 * publica de inmediato: no hay un paso intermedio de "aceptar cambios" porque
 * `LearningService.ApproveAndPublish` es atómico y el Gateway ya exige el rol
 * `coordinador_editorial` para llegar aquí (`RequireRole`, `routes.go`).
 */
@Component({
  selector: 'fc-review',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './review.component.html',
})
export class ReviewComponent implements OnInit {
  private readonly api = inject(EditorialApiService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<ArticleVersion[]>([]);
  protected readonly publishing = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  public ngOnInit(): void {
    this.load();
  }

  protected preview(version: ArticleVersion): string {
    const body = version.body ?? '';
    return body.length > 160 ? `${body.slice(0, 160)}…` : body;
  }

  /** Aprueba y publica; FR-008 se refuerza en Aprendizaje, no aquí (el Gateway solo
   * puede exigir el ROL, no que el coordinador difiera del autor). */
  protected onApprove(version: ArticleVersion): void {
    if (this.publishing() !== null) {
      return;
    }
    this.publishing.set(version.version_id);
    this.errorMessage.set(null);

    this.api.approveAndPublish(version.version_id).subscribe({
      next: () => {
        this.publishing.set(null);
        this.items.set(this.items().filter((v) => v.version_id !== version.version_id));
      },
      error: (err: unknown) => {
        this.publishing.set(null);
        this.errorMessage.set(err instanceof EditorialError ? err.message : 'No pudimos publicar el artículo.');
      },
    });
  }

  private load(): void {
    this.state.set('loading');
    this.api.listVersions({ state: 'en_revision' }).subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }
}
