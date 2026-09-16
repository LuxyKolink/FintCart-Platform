import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import {
  BadgeComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  IconComponent,
  LinkButtonComponent,
  SkeletonComponent,
  type BadgeTone,
} from '../../../shared/ui';
import { AuthService } from '../../../core/auth/auth.service';
import { EditorialApiService } from '../editorial-api.service';
import { ArticleVersion } from '../editorial.types';
import { authorLabel, versionStateLabel, versionStateTone } from '../version-state';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Historial de versiones de un artículo, o borradores propios del editor (T169, FR-013;
 * T065/T068 de 003, FR-114/FR-117).
 *
 * Un solo componente para las dos vistas: con `:articleId` en la ruta filtra por artículo
 * (trazabilidad histórica completa); sin él, filtra por `editor_id` del usuario autenticado
 * (sus propios borradores, en cualquier estado).
 *
 * NO HAY CONTADORES POR ESTADO, a propósito. El kit dibuja tres tarjetas con «Borradores /
 * En revisión / Publicados», pero los dos filtros devuelven UNA PÁGINA: contar sus elementos
 * daría un total que parece del sistema y es solo del trozo que llegó. Para que una cifra así
 * fuera cierta habría que conocer los totales por estado, y la API solo devuelve `total_size`
 * del conjunto filtrado. Se prefieren los distintivos por versión (FR-114) a un número falso
 * (nota N-15); queda como hallazgo (FR-122).
 */
@Component({
  selector: 'fc-versions',
  standalone: true,
  imports: [
    DatePipe,
    BadgeComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    IconComponent,
    LinkButtonComponent,
    SkeletonComponent,
  ],
  templateUrl: './versions.component.html',
  styleUrl: './versions.component.css',
})
export class VersionsComponent implements OnInit {
  private readonly api = inject(EditorialApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<ArticleVersion[]>([]);
  protected readonly articleId = signal<string | null>(null);

  public ngOnInit(): void {
    this.load();
  }

  protected retry(): void {
    this.state.set('loading');
    this.load();
  }

  protected stateLabel(state: string): string {
    return versionStateLabel(state);
  }

  protected stateTone(state: string): BadgeTone {
    return versionStateTone(state);
  }

  protected authorOf(version: ArticleVersion): string {
    return authorLabel(version.created_by, this.auth.userId());
  }

  protected isMine(version: ArticleVersion): boolean {
    return version.created_by === this.auth.userId();
  }

  private load(): void {
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
}
