import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AuthService } from '../../../core/auth/auth.service';
import { EditorialApiService } from '../editorial-api.service';
import { ArticleVersion } from '../editorial.types';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Historial de versiones de un artículo, o borradores propios del editor (T169,
 * FR-013).
 *
 * Un solo componente para las dos vistas: con `:articleId` en la ruta filtra por
 * artículo (trazabilidad histórica completa); sin él, filtra por `editor_id` del
 * usuario autenticado (sus propios borradores, en cualquier estado) — la misma
 * consulta de `LearningService.ListVersions` sirve a las dos, según qué filtro llegue
 * relleno.
 */
@Component({
  selector: 'fc-versions',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './versions.component.html',
})
export class VersionsComponent implements OnInit {
  private readonly api = inject(EditorialApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<ArticleVersion[]>([]);
  protected readonly articleId = signal<string | null>(null);

  public ngOnInit(): void {
    const articleId = this.route.snapshot.paramMap.get('articleId');
    this.articleId.set(articleId);

    const filter = articleId !== null ? { article_id: articleId } : { editor_id: this.auth.userId() ?? '' };
    this.api.listVersions(filter).subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected isMine(version: ArticleVersion): boolean {
    return version.created_by === this.auth.userId();
  }
}
