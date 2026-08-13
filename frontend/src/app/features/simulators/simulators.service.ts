import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CalcType, Page, SimulationHistoryEntry, SimulationRequest, SimulationResult } from './simulators.types';

export type SimulationErrorKind = 'offline' | 'invalid' | 'server';

/**
 * Error clasificado de una llamada a simuladores (T128, Edge Cases spec.md línea 133:
 * «¿Qué sucede ante una pérdida de conexión durante ... la ejecución de una
 * simulación?»). El llamador decide el mensaje y si ofrece reintentar según `kind`.
 */
export class SimulationError extends Error {
  public readonly kind: SimulationErrorKind;

  public constructor(kind: SimulationErrorKind, message: string) {
    super(message);
    this.name = 'SimulationError';
    this.kind = kind;
  }
}

@Injectable({ providedIn: 'root' })
export class SimulatorsService {
  private readonly http = inject(HttpClient);

  public run(calcType: CalcType, request: SimulationRequest): Observable<SimulationResult> {
    return this.http
      .post<SimulationResult>(`${environment.apiBaseUrl}/simulators/${calcType}/run`, request)
      .pipe(catchError((err: unknown) => throwError(() => this.classify(err))));
  }

  public listHistory(pageToken?: string): Observable<Page<SimulationHistoryEntry>> {
    let params = new HttpParams();
    if (pageToken !== undefined) {
      params = params.set('page_token', pageToken);
    }
    return this.http
      .get<Page<SimulationHistoryEntry>>(`${environment.apiBaseUrl}/simulators/history`, { params })
      .pipe(catchError((err: unknown) => throwError(() => this.classify(err))));
  }

  /**
   * Distingue la pérdida de conexión de un rechazo real del servidor. Angular reporta
   * `status === 0` cuando la petición nunca completó en la red (sin conexión, DNS
   * caído) — no hay cuerpo de error que leer, y mostrar "petición inválida" ahí le
   * echaría al usuario la culpa de un problema que es de su red, no de sus datos. El
   * formulario NUNCA se limpia en ningún caso (Edge Cases): lo único que decide
   * `kind` es el mensaje y si tiene sentido ofrecer "reintentar" de inmediato.
   */
  private classify(err: unknown): SimulationError {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return new SimulationError(
          'offline',
          'Parece que perdiste la conexión. Tus datos siguen aquí — intenta de nuevo.',
        );
      }
      if (err.status >= 400 && err.status < 500) {
        return new SimulationError('invalid', 'Revisa los parámetros ingresados e intenta de nuevo.');
      }
    }
    return new SimulationError('server', 'No pudimos completar la operación. Intenta de nuevo.');
  }
}
