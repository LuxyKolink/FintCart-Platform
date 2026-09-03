import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Category, CategoryCatalog, CategoryInput } from '../learning/learning.types';

export type AdminErrorKind = 'offline' | 'forbidden' | 'conflict' | 'invalid' | 'server';

/**
 * Error clasificado de una llamada de administración (US1, T058). Mismo mecanismo que
 * `EditorialError`/`ProfileError`: el llamador decide el mensaje según `kind`. Para el
 * `409` se distinguen los DOS códigos que el Gateway emite sobre el catálogo — ver
 * `services/api-gateway/internal/handler/admin.go`:
 *
 * - `category_in_use`: desactivar una categoría con artículos publicados (FR-035). El
 *   mensaje del borde ya es castellano fijo y lleva el recuento; se presenta tal cual.
 * - `conflict` (genérico): nombre, slug o posición ya en uso (FR-032) — el mensaje del
 *   borde es deliberadamente seco, así que el formulario lo redacta.
 */
export class AdminError extends Error {
  public readonly kind: AdminErrorKind;
  public readonly code?: string;
  public readonly publishedCount?: number;

  public constructor(
    kind: AdminErrorKind,
    message: string,
    code?: string,
    publishedCount?: number,
  ) {
    super(message);
    this.name = 'AdminError';
    this.kind = kind;
    this.code = code;
    this.publishedCount = publishedCount;
  }
}

interface ConflictBody {
  code?: string;
  message?: string;
  published_count?: number;
}

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);

  /** Catálogo completo, incluidas las categorías desactivadas (solo `/admin`). */
  public listCategories(): Observable<Category[]> {
    return this.request(
      this.http
        .get<CategoryCatalog>(`${environment.apiBaseUrl}/admin/categories`)
        .pipe(map((c) => c.categories)),
    );
  }

  public createCategory(body: CategoryInput): Observable<Category> {
    return this.request(
      this.http.post<Category>(`${environment.apiBaseUrl}/admin/categories`, body),
    );
  }

  public updateCategory(categoryId: string, body: CategoryInput): Observable<Category> {
    return this.request(
      this.http.patch<Category>(`${environment.apiBaseUrl}/admin/categories/${categoryId}`, body),
    );
  }

  /** Desactivación LÓGICA (FR-035): el `DELETE` responde 204 y no devuelve recurso. */
  public deactivateCategory(categoryId: string): Observable<void> {
    return this.request(
      this.http
        .delete<void>(`${environment.apiBaseUrl}/admin/categories/${categoryId}`)
        .pipe(map(() => undefined)),
    );
  }

  private request<T>(source: Observable<T>): Observable<T> {
    return source.pipe(catchError((err: unknown) => throwError(() => this.classify(err))));
  }

  private classify(err: unknown): AdminError {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return new AdminError(
          'offline',
          'Parece que perdiste la conexión. Tus datos siguen aquí — intenta de nuevo.',
        );
      }
      if (err.status === 401 || err.status === 403) {
        return new AdminError('forbidden', 'Tu sesión no tiene permisos de administrador.');
      }
      if (err.status === 409) {
        const body = err.error as ConflictBody | undefined;
        if (body?.code === 'category_in_use') {
          const total = body.published_count ?? 0;
          const noun = total === 1 ? 'artículo publicado' : 'artículos publicados';
          return new AdminError(
            'conflict',
            `No se puede desactivar la categoría: tiene ${total} ${noun}. Reasigna esos artículos e inténtalo de nuevo.`,
            'category_in_use',
            total,
          );
        }
        return new AdminError(
          'conflict',
          'No se pudo guardar la categoría: ya existe una activa con ese nombre o la posición está ocupada.',
        );
      }
      if (err.status >= 400 && err.status < 500) {
        return new AdminError('invalid', 'Revisa los datos ingresados e intenta de nuevo.');
      }
    }
    return new AdminError('server', 'No pudimos completar la operación. Intenta de nuevo.');
  }
}
