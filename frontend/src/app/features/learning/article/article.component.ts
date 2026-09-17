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
import { BodyDocComponent } from './blocks/body-doc.component';
import { parseBodyDoc, type BodyDocNode } from './blocks/body-doc';
import { nextMilestone, withinMilestone } from '../progress/milestones';
import { ProgressApiService } from '../progress/progress-api.service';
import { Progress } from '../progress/progress.types';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Lector de artículos (FR-103, T033).
 *
 * DOS COSAS QUE NO SE HICIERON, Y POR QUÉ:
 *
 * 1. **El cuerpo se pinta en bloques cuando el documento viene, y en párrafos cuando no.**
 *    `body_doc` ya existe y el lector lo renderiza por componente (T133), pero el respaldo
 *    en texto plano NO se retira: hay versiones publicadas antes del documento de bloques
 *    —las hay de verdad, no es un caso teórico— y su `body` tiene que seguir leyéndose. Se
 *    elige uno u otro y nunca se mezclan: mezclarlos duplicaría el cuerpo en pantalla.
 *    El vocabulario cerrado no trae un bloque de cita, así que la cita destacada del kit no
 *    se dibuja. Sigue siendo un hallazgo (FR-122), pero ya no por falta de `body_doc`.
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
    BodyDocComponent,
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

  /**
   * El documento de bloques, interpretado y validado en forma.
   *
   * `null` significa «esta versión no tiene documento» —o que lo que llegó no tiene forma
   * de documento— y entonces se lee `body`. Se interpreta con `parseBodyDoc` y no con un
   * `as` sobre la respuesta HTTP: lo que llega por la red se comprueba antes de usarlo, y
   * el `@switch` del componente de bloques no debe recibir tipos que no conoce.
   */
  protected readonly bodyDoc = computed<BodyDocNode | null>(() =>
    parseBodyDoc(this.article()?.body_doc),
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
