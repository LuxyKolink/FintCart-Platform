import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Page, OpAck } from '../editorial/editorial.types';
import {
  Calculator,
  CalculatorApproval,
  CalculatorWriteBody,
  DefinitionIssue,
  DefinitionReport,
} from './calculator.types';

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

  /**
   * Los problemas de una definición rechazada, con su ubicación (FR-046).
   *
   * Viaja en el error y no en un canal aparte porque es parte de lo mismo: quien llama tiene que
   * poder señalar los campos que el servidor acaba de rechazar, y una respuesta de error sin la
   * lista obligaría a repetir la llamada de validación para descubrir lo que ya se dijo.
   */
  public issues: DefinitionIssue[] = [];

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

  /**
   * Comprueba una definición SIN guardarla (FR-046).
   *
   * Responde 200 con `valid` y la lista de problemas, y no un 422, porque aquí «no es válida» es
   * una respuesta legítima a una pregunta legítima: el autor está preguntando mientras escribe.
   * Los problemas vienen TODOS y cada uno con su `location`, que es lo que permite resaltar el
   * campo exacto en vez de mostrar un mensaje suelto sobre la definición entera.
   */
  public validate(body: CalculatorWriteBody): Observable<DefinitionReport> {
    return this.request(
      this.http.post<DefinitionReport>(`${environment.apiBaseUrl}/calculators/validate`, body),
    );
  }

  /** Crea una calculadora propia (FR-043). Nace `privada`. */
  public create(body: CalculatorWriteBody): Observable<Calculator> {
    return this.request(this.http.post<Calculator>(`${environment.apiBaseUrl}/calculators`, body));
  }

  /**
   * Guarda una versión nueva de una calculadora propia (FR-043).
   *
   * El Simulador sube la versión y **no toca lo publicado**: si la calculadora estaba publicada,
   * lo que el catálogo sirve sigue siendo la versión aprobada hasta que un coordinador apruebe
   * esta (FR-052). Editar una que está `en_revision` retira la propuesta, y es deliberado.
   */
  public update(calculatorId: string, body: CalculatorWriteBody): Observable<Calculator> {
    return this.request(
      this.http.put<Calculator>(`${environment.apiBaseUrl}/calculators/${calculatorId}`, body),
    );
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
      if (err.status === 422) {
        // 422 y no 400: la petición está bien formada y lo que no se puede procesar es su
        // contenido. El borde manda `code`, `message` y `errors[]` con la ubicación de cada
        // problema, así que NO se descarta: el constructor resalta el campo exacto con esto.
        const body = err.error as { errors?: DefinitionIssue[] } | null;
        const problemas = body?.errors ?? [];
        const error = new CalculatorError(
          'invalid',
          problemas.length === 1
            ? problemas[0].message
            : `La definición tiene ${problemas.length} problemas que hay que corregir.`,
        );
        error.issues = problemas;
        return error;
      }
      if (err.status === 400) {
        // El 400 SÍ lleva su motivo, y el motivo es lo que el autor de la calculadora escribió
        // para quien la usa: «El monto tiene que superar 1000». El borde lo transporta desde que
        // se corrigió ese camino, así que ignorarlo aquí y poner una frase propia devolvería el
        // problema al punto de partida —el usuario leyendo «la operación no se pudo completar»
        // cuando la explicación existe y se redactó a propósito (FR-044, FR-045)—.
        //
        // Si el cuerpo no trae mensaje —un 400 de otra ruta— se cae al texto propio: un cuerpo
        // vacío no puede quedarse sin explicación.
        const body = err.error as { message?: string } | null;
        const propio = body?.message ?? '';
        return new CalculatorError(
          'invalid',
          propio === ''
            ? 'La operación no se pudo completar en ese estado. Recarga la página y vuelve a intentarlo.'
            : propio,
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
