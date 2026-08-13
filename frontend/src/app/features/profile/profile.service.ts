import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { SagaAccepted } from '../../core/auth/auth.types';
import { Page } from '../simulators/simulators.types';
import {
  ActivityReport,
  ChangePasswordRequest,
  InAppNotification,
  PersonalData,
  Profile,
  UpdateProfileRequest,
} from './profile.types';

export type ProfileErrorKind = 'offline' | 'invalid' | 'server';

/**
 * Error clasificado de una llamada de perfil (T152, Edge Cases spec.md línea
 * 133: «¿Qué sucede ante una pérdida de conexión durante ... el guardado de
 * perfil?»). Mismo mecanismo que `SimulationError` en
 * `features/simulators/simulators.service.ts`: el llamador decide el mensaje y
 * si ofrece reintentar según `kind`, y el formulario NUNCA se limpia — los
 * datos que el usuario escribió siguen ahí tras el error.
 */
export class ProfileError extends Error {
  public readonly kind: ProfileErrorKind;

  public constructor(kind: ProfileErrorKind, message: string) {
    super(message);
    this.name = 'ProfileError';
    this.kind = kind;
  }
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);

  public getProfile(): Observable<Profile> {
    return this.request(this.http.get<Profile>(`${environment.apiBaseUrl}/me/profile`));
  }

  public updateProfile(body: UpdateProfileRequest): Observable<unknown> {
    return this.request(this.http.patch(`${environment.apiBaseUrl}/me/profile`, body));
  }

  public getActivityReport(): Observable<ActivityReport> {
    return this.request(this.http.get<ActivityReport>(`${environment.apiBaseUrl}/me/report`));
  }

  public getPersonalData(): Observable<PersonalData> {
    return this.request(this.http.get<PersonalData>(`${environment.apiBaseUrl}/me/data`));
  }

  public changePassword(body: ChangePasswordRequest): Observable<unknown> {
    return this.request(this.http.patch(`${environment.apiBaseUrl}/me/password`, body));
  }

  public deleteAccount(): Observable<SagaAccepted> {
    return this.request(this.http.delete<SagaAccepted>(`${environment.apiBaseUrl}/me/account`));
  }

  public listNotifications(pageToken?: string): Observable<Page<InAppNotification>> {
    let params = new HttpParams();
    if (pageToken !== undefined) {
      params = params.set('page_token', pageToken);
    }
    return this.request(
      this.http.get<Page<InAppNotification>>(`${environment.apiBaseUrl}/me/notifications`, { params }),
    );
  }

  public markNotificationRead(id: string): Observable<unknown> {
    return this.request(this.http.post(`${environment.apiBaseUrl}/me/notifications/${id}/read`, {}));
  }

  /**
   * Clasifica el fallo de cualquiera de las llamadas anteriores. `status === 0`
   * es lo que Angular reporta cuando la petición nunca llegó a completarse en
   * la red (sin conexión, DNS caído): no hay cuerpo de error que leer, y
   * mostrar «petición inválida» le echaría al usuario la culpa de un problema
   * que es de su red.
   */
  private request<T>(source: Observable<T>): Observable<T> {
    return source.pipe(catchError((err: unknown) => throwError(() => this.classify(err))));
  }

  private classify(err: unknown): ProfileError {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return new ProfileError(
          'offline',
          'Parece que perdiste la conexión. Tus datos siguen aquí — intenta de nuevo.',
        );
      }
      if (err.status === 401) {
        return new ProfileError('invalid', 'La contraseña actual no coincide.');
      }
      if (err.status >= 400 && err.status < 500) {
        return new ProfileError('invalid', 'Revisa los datos ingresados e intenta de nuevo.');
      }
    }
    return new ProfileError('server', 'No pudimos completar la operación. Intenta de nuevo.');
  }
}
