import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { LearningApiService } from '../learning-api.service';
import { Article } from '../learning.types';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

@Component({
  selector: 'fc-article',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './article.component.html',
})
export class ArticleComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(LearningApiService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly article = signal<Article | null>(null);

  public ngOnInit(): void {
    const articleId = this.route.snapshot.paramMap.get('articleId');
    if (articleId === null) {
      this.state.set('not-found');
      return;
    }
    this.api.getArticle(articleId).subscribe({
      next: (article) => {
        this.article.set(article);
        this.state.set('ready');
      },
      error: (err: unknown) => {
        const notFound =
          typeof err === 'object' && err !== null && 'status' in err && (err as { status: number }).status === 404;
        this.state.set(notFound ? 'not-found' : 'error');
      },
    });
  }
}
