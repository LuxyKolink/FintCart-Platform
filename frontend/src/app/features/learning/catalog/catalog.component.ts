import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LearningApiService } from '../learning-api.service';
import { Article } from '../learning.types';

type LoadState = 'loading' | 'ready' | 'error';

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
  protected readonly allCategories = signal<string[]>([]);
  protected readonly activeCategory = signal<string | null>(null);

  public ngOnInit(): void {
    // Primera carga sin filtro: de aquí se derivan las categorías disponibles
    // (el contrato no expone un listado de categorías propio, FR-010).
    this.load(undefined);
  }

  protected selectCategory(category: string | null): void {
    this.activeCategory.set(category);
    this.load(category ?? undefined);
  }

  private load(category: string | undefined): void {
    this.state.set('loading');
    this.api.listArticles(category).subscribe({
      next: (page) => {
        this.articles.set(page.items);
        if (category === undefined) {
          const seen = new Set(page.items.map((a) => a.category));
          this.allCategories.set([...seen].sort());
        }
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }
}
