import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { TokenStorageService } from './token-storage.service';

/** Rutas que nunca llevan `Authorization` ni disparan refresco (son las que lo emiten). */
const PUBLIC_PATHS = ['/oauth/authorize', '/oauth/token', '/auth/register', '/auth/verify-email'];

function isPublicPath(url: string): boolean {
  return PUBLIC_PATHS.some((path) => url.includes(path));
}

/**
 * Adjunta el `Bearer` a cada petición al Gateway y, ante un 401, intenta UN
 * refresco silencioso con el refresh_token antes de dar el error por bueno.
 * Un segundo 401 tras refrescar ya no reintenta: evita un bucle infinito
 * contra una sesión que el servidor ha revocado de verdad (FR-004).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const tokens = inject(TokenStorageService);
  const auth = inject(AuthService);

  const targetsApi = req.url.startsWith(environment.apiBaseUrl);
  const accessToken = tokens.getAccessToken();

  const authorized =
    targetsApi && accessToken !== null && !isPublicPath(req.url)
      ? req.clone({ setHeaders: { Authorization: `Bearer ${accessToken}` } })
      : req;

  return next(authorized).pipe(
    catchError((err: unknown) => {
      const shouldRefresh =
        err instanceof HttpErrorResponse && err.status === 401 && targetsApi && !isPublicPath(req.url);
      if (!shouldRefresh) {
        return throwError(() => err);
      }

      return auth.refresh().pipe(
        switchMap(() => {
          const retried = req.clone({
            setHeaders: { Authorization: `Bearer ${tokens.getAccessToken() ?? ''}` },
          });
          return next(retried);
        }),
        catchError((refreshErr: unknown) => {
          auth.clearSession();
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
