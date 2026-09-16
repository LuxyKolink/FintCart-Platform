import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  BadgeComponent,
  ButtonComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  IconComponent,
  LinkButtonComponent,
  ModuleBoxComponent,
  ProgressBarComponent,
  SkeletonComponent,
  TabsComponent,
  type BadgeTone,
  type TabItem,
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
 * Identificador de la pestaña «Todos». NO es un `category_id`: es una clave de
 * presentación que no puede colisionar con un UUID del catálogo.
 */
const ALL_CATEGORIES = '__todas__';

/**
 * Tono de `fc-badge` por `slug` de categoría (FR-102).
 *
 * El vocabulario del design system es cerrado y la paleta también, pero el catálogo es
 * administrable (FR-081): puede aparecer una categoría que no estaba cuando esto se
 * escribió. Una categoría desconocida cae en `neutral`, que es exactamente lo que dice
 * ser. Lo que NO se hace es inventar un color fuera de la paleta por `slug`.
 */
const TONE_BY_SLUG: Record<string, BadgeTone> = {
  ahorro: 'success',
  credito: 'info',
  presupuesto: 'accent',
  inversion: 'brand',
};

/**
 * Catálogo público de artículos (US1 de 002, FR-102 de 003).
 *
 * Desde 003 es un **portal de tres zonas**: riel de categorías y acceso a simuladores,
 * columna central con el artículo destacado y el catálogo con pestañas, y riel de
 * progreso y notificaciones.
 *
 * DOS COSAS QUE ESTE COMPONENTE NO HACE, A PROPÓSITO:
 *
 * 1. **No inventa cifras.** El riel derecho del kit muestra un ranking semanal, «seguir
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
    BadgeComponent,
    ButtonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    IconComponent,
    LinkButtonComponent,
    ModuleBoxComponent,
    ProgressBarComponent,
    SkeletonComponent,
    TabsComponent,
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

  protected readonly tabs = computed<TabItem[]>(() => [
    { id: ALL_CATEGORIES, label: 'Todos' },
    ...this.categories().map((category) => ({ id: category.category_id, label: category.name })),
  ]);

  protected readonly activeTab = computed(() => this.activeCategoryId() ?? ALL_CATEGORIES);

  /**
   * El artículo destacado es el primero de la lista SIN filtro. Con una categoría
   * activa no hay destacado: la primera tarjeta de la categoría no es «lo destacado del
   * portal», es simplemente la que salió primero.
   */
  protected readonly featured = computed<Article | null>(() =>
    this.activeCategoryId() === null ? (this.articles()[0] ?? null) : null,
  );

  /** Cuatro entradas bastan para el riel; la bandeja completa vive en su pantalla. */
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

  protected selectTab(tabId: string): void {
    this.selectCategory(tabId === ALL_CATEGORIES ? null : tabId);
  }

  /** Tono de la insignia de categoría; desconocida ⇒ `neutral`. */
  protected toneOf(article: Article): BadgeTone {
    const category = this.categories().find((item) => item.category_id === article.category_id);
    return TONE_BY_SLUG[category?.slug ?? ''] ?? 'neutral';
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
