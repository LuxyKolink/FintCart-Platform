import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import {
  BadgeComponent,
  ErrorStateComponent,
  LinkButtonComponent,
  ModuleBoxComponent,
  ProgressBarComponent,
  SkeletonComponent,
} from '../../../shared/ui';
import { LearningApiService } from '../learning-api.service';
import { Article } from '../learning.types';
import { nextMilestone, withinMilestone } from '../progress/milestones';
import { ProgressApiService } from '../progress/progress-api.service';
import { Progress } from '../progress/progress.types';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Lector de artículos (FR-103, T033).
 *
 * DOS COSAS QUE NO SE HICIERON, Y POR QUÉ:
 *
 * 1. **El cuerpo se pinta en párrafos, no en bloques con cita destacada.** El kit
 *    dibuja una cita resaltada entre párrafos y el diseño la contempla, pero el
 *    contrato vigente entrega `body` como TEXTO PLANO: `body_doc` —el documento de
 *    bloques con vocabulario cerrado que llevaría un `quote`— es de 002 y todavía no
 *    existe (T016/T131). Inventar la cita a partir del texto, o partir por líneas que
 *    empiecen por «>», sería inventar sintaxis en el cliente. La cita llega cuando
 *    llegue el bloque; queda como hallazgo (FR-122, FR-123).
 * 2. **No se muestra autor ni tiempo de lectura.** `Article` no los lleva: el contrato
 *    tiene título, categoría, cuerpo, versión vigente y cuestionarios asociados.
 *
 * Lo que sí se conserva: el contenedor es un `<article>` —`us1-aprendizaje.spec.ts` lo
 * selecciona y es el marcado correcto— y es el ÚNICO de la pantalla, porque los
 * relacionados viven en una lista y no en artículos anidados (una aserción de
 * Playwright resuelve a un solo elemento).
 */
@Component({
  selector: 'fc-article',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
      LinkButtonComponent,
    ErrorStateComponent,
    ModuleBoxComponent,
    ProgressBarComponent,
    SkeletonComponent,
  ],
  templateUrl: './article.component.html',
  styleUrl: './article.component.css',
})
export class ArticleComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(LearningApiService);
  private readonly progressApi = inject(ProgressApiService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly article = signal<Article | null>(null);
  protected readonly related = signal<Article[]>([]);

  protected readonly progressState = signal<LoadState>('loading');
  protected readonly progress = signal<Progress | null>(null);

  /**
   * Párrafos del cuerpo. El contrato entrega texto plano, así que el único corte
   * fiable es la línea en blanco; las líneas simples de dentro de un párrafo se
   * respetan con `white-space: pre-line` en la hoja de estilos.
   */
  protected readonly paragraphs = computed<string[]>(() =>
    (this.article()?.body ?? '')
      .split(/\n{2,}/u)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph !== ''),
  );

  public ngOnInit(): void {
    this.load();
    this.loadProgress();
  }

  protected retry(): void {
    this.state.set('loading');
    this.load();
  }

  protected withinMilestone(points: number): number {
    return withinMilestone(points);
  }

  protected nextMilestone(points: number): number {
    return nextMilestone(points);
  }

  private load(): void {
    const articleId = this.route.snapshot.paramMap.get('articleId');
    if (articleId === null) {
      this.state.set('not-found');
      return;
    }
    this.state.set('loading');
    this.api.getArticle(articleId).subscribe({
      next: (article) => {
        this.article.set(article);
        this.state.set('ready');
        this.loadRelated(article);
      },
      error: (err: unknown) => {
        const notFound =
          typeof err === 'object' && err !== null && 'status' in err && (err as { status: number }).status === 404;
        this.state.set(notFound ? 'not-found' : 'error');
      },
    });
  }

  /**
   * Relacionados = otros artículos de la MISMA categoría, pedidos al mismo listado que
   * usa el catálogo. Sin endpoint de recomendaciones, «relacionado» solo puede
   * significar algo comprobable: comparte categoría. Si la categoría no aporta ninguno,
   * el panel no se pinta en lugar de rellenarse con artículos de cualquier tema.
   */
  private loadRelated(article: Article): void {
    this.api.listArticles(article.category_id).subscribe({
      next: (page) => {
        this.related.set(
          page.items.filter((item) => item.article_id !== article.article_id).slice(0, 3),
        );
      },
      // Los relacionados son accesorios: si fallan, el artículo se sigue leyendo.
      error: () => this.related.set([]),
    });
  }

  private loadProgress(): void {
    this.progressApi.getProgress().subscribe({
      next: (progress) => {
        this.progress.set(progress);
        this.progressState.set('ready');
      },
      error: () => this.progressState.set('error'),
    });
  }
}
