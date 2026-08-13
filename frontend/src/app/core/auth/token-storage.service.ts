import { Injectable } from '@angular/core';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

const ACCESS_KEY = 'fc_access_token';
const REFRESH_KEY = 'fc_refresh_token';

/**
 * `sessionStorage` y no `localStorage`: la sesión no debe sobrevivir al cierre
 * de la pestaña sin pasar de nuevo por login — FR-004 exige que cerrar sesión
 * (o cerrarla implícitamente) revoque el acceso, y persistir en `localStorage`
 * dejaría el token vivo indefinidamente en el disco del usuario.
 */
@Injectable({ providedIn: 'root' })
export class TokenStorageService {
  public save(tokens: StoredTokens): void {
    sessionStorage.setItem(ACCESS_KEY, tokens.accessToken);
    sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  }

  public getAccessToken(): string | null {
    return sessionStorage.getItem(ACCESS_KEY);
  }

  public getRefreshToken(): string | null {
    return sessionStorage.getItem(REFRESH_KEY);
  }

  public clear(): void {
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
  }
}
