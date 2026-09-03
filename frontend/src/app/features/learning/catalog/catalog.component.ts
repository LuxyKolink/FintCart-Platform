import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LearningApiService } from '../learning-api.service';
import { Article, Category } from '../learning.types';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Catálogo público de artículos (US1, T060).
 *
 * El filtro deja de derivarse de los nombres que trae cada artículo cargado y pasa a
 * consumir el listado de categorías ACTIVAS de `/catalog/categories` (FR-032): una
 * categoría sin artículos publicados debe ofrecerse igual en el filtro, y la selección
 * viaja por `category_id` — el nombre visible nunca es un identificador fiable.
 */
@Component({
  selector: 'fc-catalog',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './catalog.component.html',
})
export class CatalogComponent implements OnInit {
  private readonly api = inject(LearningApiService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly articles = signal<Article[]>([]);
  protected readonly categories = signal<Category[]>([]);
  /** `category_id` de la categoría activa, o `null` para «todas». */
  protected readonly activeCategoryId = signal<string | null>(null);

  public ngOnInit(): void {
    // La lista de categorías alimenta el filtro en paralelo a la primera carga de
    // artículos: no depende de que exista un artículo ya publicado en la categoría.
    this.api.listCategories().subscribe({
      next: (categories) => this.categories.set(categories),
      error: () => this.categories.set([]),
    });
    this.load(undefined);
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
