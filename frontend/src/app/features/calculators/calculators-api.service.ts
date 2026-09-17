import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Page, OpAck } from '../editorial/editorial.types';
import { Calculator, CalculatorApproval } from './calculator.types';

/**
 * Error clasificado de una llamada de curaduría (US5, T116–T119).
 *
 * Mismo mecanismo que `EditorialError`, `ProfileError` y `SimulationError`: el llamador decide
 * el mensaje según `kind`. Tres de los cuatro `kind` son propios de esta pantalla y no del
 * resto de la plataforma:
 *
 * - `forbidden`: FR-053 — nadie aprueba su propia calculadora. Es un caso que merece un mensaje
 *   distinto de «revisa los datos», porque los datos no son el problema.
 * - `notFound`: la calculadora no existe o **no es visible para quien pregunta**. El contrato
 *   devuelve lo MISMO en los dos casos a propósito —distinguirlos sería un oráculo sobre las
 *   calculadoras privadas ajenas— y el mensaje lo refleja sin afirmar cuál de los dos es.
 * - `invalid`: el Simulador rechaza la transición («no hay nada que proponer», «ya está en
 *   revisión»). El borde no deja pasar el mensaje interno, así que aquí se redacta el caso
 *   general.
 */
export type CalculatorErrorKind = 'offline' | 'forbidden' | 'notFound' | 'invalid' | 'server';

export class CalculatorError extends Error {
  public readonly kind: CalculatorErrorKind;

  public constructor(kind: CalculatorErrorKind, message: string) {
    super(message);
    this.name = 'CalculatorError';
    this.kind = kind;
  }
}

/** Resultado de ejecutar una calculadora, con su procedencia (FR-050, FR-058). */
export interface CalculatorRunResult {
  simulation_id: string;
  result: Record<string, string>;
  calculator_id?: string;
  calculator_version?: number;
  indicators_used?: Record<string, string>;
}

/**
 * Acceso al constructor y a la curaduría de calculadoras.
 *
 * Todas las rutas viven en el Gateway (`services/api-gateway/internal/handler/calculators.go`)
 * y este servicio no decide ningún permiso: manda el token y traduce lo que vuelve.
 */
@Injectable({ providedIn: 'root' })
export class CalculatorsApiService {
  private readonly http = inject(HttpClient);

  /** Las propias, publicadas o no (FR-051). */
  public listMine(pageToken = ''): Observable<Page<Calculator>> {
    return this.request(this.http.get<Page<Calculator>>(`${environment.apiBaseUrl}/me/calculators`, { params: token(pageToken) }));
  }

  /** El catálogo público: solo publicadas (FR-052). */
  public listCatalog(pageToken = ''): Observable<Page<Calculator>> {
    return this.request(this.http.get<Page<Calculator>>(`${environment.apiBaseUrl}/calculators`, { params: token(pageToken) }));
  }

  /** La bandeja de curaduría: lo que espera revisión (FR-052). */
  public listForReview(pageToken = ''): Observable<Page<Calculator>> {
    return this.request(
      this.http.get<Page<Calculator>>(`${environment.apiBaseUrl}/editorial/calculators`, { params: token(pageToken) }),
    );
  }

  public get(calculatorId: string): Observable<Calculator> {
    return this.request(this.http.get<Calculator>(`${environment.apiBaseUrl}/calculators/${calculatorId}`));
  }

  /** Propone una calculadora propia para el catálogo (FR-052). */
  public submitForReview(calculatorId: string): Observable<OpAck> {
    return this.request(
      this.http.post<OpAck>(`${environment.apiBaseUrl}/calculators/${calculatorId}/submit`, {}),
    );
  }

  /** Aprueba una calculadora propuesta (FR-053). Devuelve la versión publicada. */
  public approve(calculatorId: string): Observable<CalculatorApproval> {
    return this.request(
      this.http.post<CalculatorApproval>(`${environment.apiBaseUrl}/editorial/calculators/${calculatorId}/approve`, {}),
    );
  }

  /** Rechaza una propuesta con un motivo obligatorio (FR-054). */
  public reject(calculatorId: string, reason: string): Observable<OpAck> {
    return this.request(
      this.http.post<OpAck>(`${environment.apiBaseUrl}/editorial/calculators/${calculatorId}/reject`, { reason }),
    );
  }

  /**
   * Ejecuta una calculadora por su DEFINICIÓN (FR-050).
   *
   * Los `inputs` van como `Record<string, string>` y el cliente NO los convierte a número: la
   * aritmética la hace el Simulador con `rust_decimal`, y convertir aquí a `number` rompería el
   * Principio VIII en la frontera —el error clásico de `0.1 + 0.2`—. Lo que se comprueba en
   * esta pantalla es que el campo esté relleno y que el texto sea un decimal; la validez de
   * fondo la decide quien calcula.
   */
  public run(calculatorId: string, inputs: Record<string, string>): Observable<CalculatorRunResult> {
    return this.request(
      this.http.post<CalculatorRunResult>(`${environment.apiBaseUrl}/calculators/${calculatorId}/run`, { inputs }),
    );
  }

  private request<T>(source: Observable<T>): Observable<T> {
    return source.pipe(catchError((err: unknown) => throwError(() => this.classify(err))));
  }

  private classify(err: unknown): CalculatorError {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return new CalculatorError(
          'offline',
          'Parece que perdiste la conexión. Tus datos siguen aquí — intenta de nuevo.',
        );
      }
      if (err.status === 403) {
        return new CalculatorError(
          'forbidden',
          'Nadie aprueba su propia calculadora: la revisión tiene que hacerla otro coordinador (FR-053).',
        );
      }
      if (err.status === 404) {
        return new CalculatorError(
          'notFound',
          'No encontramos esa calculadora, o no es tuya. Las calculadoras privadas solo las ve su autor.',
        );
      }
      if (err.status >= 400 && err.status < 500) {
        return new CalculatorError(
          'invalid',
          'La operación no se pudo completar en ese estado. Recarga la página y vuelve a intentarlo.',
        );
      }
    }
    return new CalculatorError('server', 'No pudimos completar la operación. Intenta de nuevo.');
  }
}

function token(pageToken: string): HttpParams {
  return pageToken === '' ? new HttpParams() : new HttpParams().set('page_token', pageToken);
}
