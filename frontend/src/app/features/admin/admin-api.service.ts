import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Category, CategoryCatalog, CategoryInput } from '../learning/learning.types';
import {
  CalendarStatus,
  Indicator,
  IndicatorInput,
} from './indicators/indicator.types';

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
  /**
   * Vigencias que ya existen para el indicador que se intentó cargar (FR-059).
   *
   * Viaja en el `409` de indicadores porque el borde la consulta y la devuelve: el
   * mensaje interno del servicio no cruza la frontera gRPC, así que sin esto la pantalla
   * diría «ya existe» sin poder nombrar cuál de las dos cifras sobra.
   */
  public readonly existing?: Indicator[];

  public constructor(
    kind: AdminErrorKind,
    message: string,
    code?: string,
    publishedCount?: number,
    existing?: Indicator[],
  ) {
    super(message);
    this.name = 'AdminError';
    this.kind = kind;
    this.code = code;
    this.publishedCount = publishedCount;
    this.existing = existing;
  }
}

interface ConflictBody {
  code?: string;
  message?: string;
  published_count?: number;
  existing?: Indicator[];
}

/**
 * Qué se estaba guardando cuando llegó un conflicto.
 *
 * Existe porque el `409` genérico del borde —«conflicto»— es el mismo para el catálogo y
 * para los indicadores, y el mensaje que lee la persona tiene que hablar de lo que tenía
 * delante: decirle «ya existe una categoría con ese nombre» a quien está cargando el UVT
 * es peor que no decir nada.
 */
type ConflictContext = 'category' | 'indicator';

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

  // ── indicadores financieros (T108, FR-055…FR-062) ────────────────────────

  /**
   * Todas las vigencias, o solo las que rigen ese día.
   *
   * Sin `onDate` devuelve el HISTÓRICO: es lo que necesita esta pantalla, porque
   * «qué está vigente hoy» y «qué hay cargado» son dos preguntas distintas y la
   * segunda es la que detecta un hueco.
   */
  public listIndicators(filters: { name?: string; onDate?: string } = {}): Observable<Indicator[]> {
    let params = new HttpParams();
    if (filters.name !== undefined && filters.name !== '') {
      params = params.set('name', filters.name);
    }
    if (filters.onDate !== undefined && filters.onDate !== '') {
      params = params.set('on_date', filters.onDate);
    }
    return this.request(
      this.http.get<Indicator[]>(`${environment.apiBaseUrl}/admin/indicators`, { params }),
    );
  }

  /** Estado del procedimiento anual: sin vigencia y por vencer (FR-061). */
  public indicatorCalendarStatus(): Observable<CalendarStatus> {
    return this.request(
      this.http.get<CalendarStatus>(`${environment.apiBaseUrl}/admin/indicators/status`),
    );
  }

  public createIndicator(body: IndicatorInput): Observable<Indicator> {
    return this.request(
      this.http.post<Indicator>(`${environment.apiBaseUrl}/admin/indicators`, body),
      'indicator',
    );
  }

  /** Corrección de una vigencia existente: mismo identificador, no una versión nueva. */
  public updateIndicator(indicatorId: string, body: IndicatorInput): Observable<Indicator> {
    return this.request(
      this.http.put<Indicator>(`${environment.apiBaseUrl}/admin/indicators/${indicatorId}`, body),
      'indicator',
    );
  }

  /**
   * `context` dice qué se estaba guardando, y se pasa desde el MÉTODO y no por las
   * opciones de la petición: el `context` de `HttpClient` es un objeto de contexto de
   * Angular —interceptores, reintentos—, no un sitio donde colgar datos propios, y
   * usarlo así habría funcionado hasta que un interceptor lo mirara.
   */
  private request<T>(source: Observable<T>, context: ConflictContext = 'category'): Observable<T> {
    return source.pipe(
      catchError((err: unknown) => throwError(() => this.classify(err, context))),
    );
  }

  private classify(err: unknown, context: ConflictContext): AdminError {
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
        return this.conflict(body, context);
      }
      if (err.status >= 400 && err.status < 500) {
        return new AdminError('invalid', 'Revisa los datos ingresados e intenta de nuevo.');
      }
    }
    return new AdminError('server', 'No pudimos completar la operación. Intenta de nuevo.');
  }

  /**
   * El `409` genérico, redactado según lo que se estaba guardando.
   *
   * En indicadores lleva además las vigencias que chocan: quien carga el UVT del año
   * siguiente necesita ver cuál de las dos cifras sobra, y esa lista la consulta el
   * borde precisamente porque el mensaje del servicio no cruza la frontera gRPC.
   */
  private conflict(body: ConflictBody | undefined, context: ConflictContext): AdminError {
    const existing = body?.existing ?? undefined;

    if (context === 'indicator') {
      return new AdminError(
        'conflict',
        'Ese indicador ya tiene una vigencia que se solapa con las fechas indicadas. Revisa las vigencias del final de la página.',
        'indicator_overlap',
        undefined,
        existing,
      );
    }

    return new AdminError(
      'conflict',
      'No se pudo guardar la categoría: ya existe una activa con ese nombre o la posición está ocupada.',
    );
  }
}
