import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { RegisterRequest, SagaAccepted, VerifyEmailRequest } from './auth.types';

/**
 * `POST /auth/register` y `POST /auth/verify-email` — arrancan sagas en el
 * Orquestador (FR-001/FR-002) y no requieren sesión previa. Separado de
 * {@link AuthService} porque ese servicio es sobre la SESIÓN (tokens); estas
 * dos llamadas ocurren antes de que exista una.
 */
@Injectable({ providedIn: 'root' })
export class IdentityApiService {
  private readonly http = inject(HttpClient);

  /**
   * También sirve como "reenviar verificación": el contrato no declara un
   * endpoint dedicado (ver Edge Cases de `spec.md`), así que reenviar es
   * volver a registrar el mismo correo. El Orquestador/Auth deciden si el
   * usuario ya está verificado (409) o si corresponde emitir un nuevo token.
   */
  public register(body: RegisterRequest): Observable<SagaAccepted> {
    return this.http.post<SagaAccepted>(`${environment.apiBaseUrl}/auth/register`, body);
  }

  public verifyEmail(body: VerifyEmailRequest): Observable<SagaAccepted> {
    return this.http.post<SagaAccepted>(`${environment.apiBaseUrl}/auth/verify-email`, body);
  }
}
