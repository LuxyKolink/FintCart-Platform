import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  ButtonComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  IconComponent,
  ProgressBarComponent,
  SkeletonComponent,
} from '../../../shared/ui';
import { notificationTypeLabel } from '../../notifications/notification-labels';
import { ProfileService } from '../../profile/profile.service';
import { InAppNotification } from '../../profile/profile.types';
import { LearningApiService } from '../learning-api.service';
import { Article, Category } from '../learning.types';
import { nextMilestone, withinMilestone } from '../progress/milestones';
import { ProgressApiService } from '../progress/progress-api.service';
import { Progress } from '../progress/progress.types';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Catálogo público de artículos (US1 de 002, FR-102 de 003).
 *
 * Dirección de arte v2 (brief §4, §8): UNA sola columna de `--content-max`. El portal de
 * tres zonas de 003 —riel de categorías con borde, columna central, riel derecho de
 * progreso y avisos— se retiró: las categorías son una fila de enlaces de texto y el
 * progreso y la bandeja viven en el flujo.
 *
 * DOS COSAS QUE ESTE COMPONENTE NO HACE, A PROPÓSITO:
 *
 * 1. **No inventa cifras.** El kit de referencia mostraba un ranking semanal, «seguir
 *    leyendo» y un porcentaje de avance por categoría. Ninguno de los tres existe en los
 *    contratos —no hay endpoint de ranking, ni de «continuar», ni progreso por
 *    categoría—, así que no se pintan. Un ranking inventado no es un texto incompleto:
 *    es un dato falso (nota N-15). Quedan como hallazgos en `tasks.md` (FR-122).
 * 2. **No filtra por dificultad ni por minutos de lectura.** El kit lo hace, pero
 *    `Article` no lleva ninguna de las dos cosas: el contrato tiene título, categoría,
 *    cuerpo, versión y cuestionarios asociados.
 */
@Component({
  selector: 'fc-catalog',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    ButtonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    IconComponent,
    ProgressBarComponent,
    SkeletonComponent,
  ],
  templateUrl: './catalog.component.html',
  styleUrl: './catalog.component.css',
})
export class CatalogComponent implements OnInit {
  private readonly api = inject(LearningApiService);
  private readonly progressApi = inject(ProgressApiService);
  private readonly profileApi = inject(ProfileService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly articles = signal<Article[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly categoriesState = signal<LoadState>('loading');
  /** `category_id` de la categoría activa, o `null` para «todas». */
  protected readonly activeCategoryId = signal<string | null>(null);

  /**
   * Riel derecho. Cada zona se carga por su cuenta y con su propio estado: que la
   * bandeja falle no puede dejar el catálogo en blanco, y al revés. FR-118 pide estado
   * de carga y error en toda pantalla que dependa de datos, y el catálogo depende de
   * cuatro fuentes.
   */
  protected readonly progressState = signal<LoadState>('loading');
  protected readonly progress = signal<Progress | null>(null);
  protected readonly inboxState = signal<LoadState>('loading');
  protected readonly inbox = signal<InAppNotification[]>([]);

  /**
   * El artículo destacado es el primero de la lista SIN filtro. Con una categoría
   * activa no hay destacado: la primera tarjeta de la categoría no es «lo destacado del
   * portal», es simplemente la que salió primero.
   */
  protected readonly featured = computed<Article | null>(() =>
    this.activeCategoryId() === null ? (this.articles()[0] ?? null) : null,
  );

  /** Cuatro entradas bastan para la vista previa; la bandeja completa vive en su pantalla. */
  protected readonly inboxPreview = computed(() => this.inbox().slice(0, 4));
  protected readonly unreadCount = computed(
    () => this.inbox().filter((item) => item.read_state === 'unread').length,
  );

  public ngOnInit(): void {
    this.loadCategories();
    this.load(undefined);
    this.loadProgress();
    this.loadInbox();
  }

  protected selectCategory(categoryId: string | null): void {
    this.activeCategoryId.set(categoryId);
    this.load(categoryId ?? undefined);
  }

  /** Nombre visible de la tarjeta: el que trae el artículo, o el del catálogo. */
  protected nameOf(article: Article): string {
    if (article.category) {
      return article.category;
    }
    const hit = this.categories().find((category) => category.category_id === article.category_id);
    return hit?.name ?? article.category;
  }

  protected labelOf(item: InAppNotification): string {
    return notificationTypeLabel(item.type);
  }

  protected withinMilestone(points: number): number {
    return withinMilestone(points);
  }

  protected nextMilestone(points: number): number {
    return nextMilestone(points);
  }

  protected retryArticles(): void {
    this.load(this.activeCategoryId() ?? undefined);
  }

  protected retryProgress(): void {
    this.loadProgress();
  }

  protected retryInbox(): void {
    this.loadInbox();
  }

  private loadCategories(): void {
    this.categoriesState.set('loading');
    // La lista de categorías alimenta el filtro en paralelo a la primera carga de
    // artículos: no depende de que exista un artículo ya publicado en la categoría.
    this.api.listCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        this.categoriesState.set('ready');
      },
      error: () => {
        this.categories.set([]);
        this.categoriesState.set('error');
      },
    });
  }

  private loadProgress(): void {
    this.progressState.set('loading');
    this.progressApi.getProgress().subscribe({
      next: (progress) => {
        this.progress.set(progress);
        this.progressState.set('ready');
      },
      error: () => this.progressState.set('error'),
    });
  }

  private loadInbox(): void {
    this.inboxState.set('loading');
    this.profileApi.listNotifications(undefined).subscribe({
      next: (page) => {
        this.inbox.set(page.items);
        this.inboxState.set('ready');
      },
      error: () => this.inboxState.set('error'),
    });
  }

  private load(categoryId: string | undefined): void {
    this.state.set('loading');
    this.api.listArticles(categoryId).subscribe({
      next: (page) => {
        this.articles.set(page.items);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }
}
