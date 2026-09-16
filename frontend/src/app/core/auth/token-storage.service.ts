import { Injectable } from '@angular/core';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

const ACCESS_KEY = 'fc_access_token';
const REFRESH_KEY = 'fc_refresh_token';

/**
 * Dónde viven los tokens. La opción "Recordarme" del acceso (FR-099) elige el
 * almacén:
 *
 * - **Sin recordar** (por defecto): `sessionStorage`. La sesión no sobrevive al
 *   cierre de la pestaña sin pasar de nuevo por login — FR-004 exige que cerrar
 *   sesión revoque el acceso, y persistir en `localStorage` dejaría el token vivo
 *   indefinidamente en el disco del usuario.
 * - **Recordar**: `localStorage`. Es la única lectura en la que «mantener la
 *   sesión iniciada» es una opción de verdad y no un adorno; el usuario la pide
 *   explícitamente y `clear()` la revoca en el cierre de sesión.
 *
 * POR QUÉ EL DEFECTO NO CAMBIA: FR-121 prohíbe alterar el comportamiento
 * funcional existente. Sin tocar la casilla el comportamiento es idéntico al de
 * antes; la persistencia es una mejora opt-in, no un cambio del camino por
 * defecto. (El kit dibuja la casilla marcada; se deja desmarcada a propósito
 * porque el defecto manda el criterio de privacidad de FR-004, no el adorno.)
 */
@Injectable({ providedIn: 'root' })
export class TokenStorageService {
  public save(tokens: StoredTokens, remember = false): void {
    this.clear();
    const store = remember ? localStorage : sessionStorage;
    store.setItem(ACCESS_KEY, tokens.accessToken);
    store.setItem(REFRESH_KEY, tokens.refreshToken);
  }

  public getAccessToken(): string | null {
    return sessionStorage.getItem(ACCESS_KEY) ?? localStorage.getItem(ACCESS_KEY);
  }

  public getRefreshToken(): string | null {
    return sessionStorage.getItem(REFRESH_KEY) ?? localStorage.getItem(REFRESH_KEY);
  }

  /** `true` si la sesión se guardó con «Recordarme», para conservar el almacén al refrescar. */
  public isPersistent(): boolean {
    return localStorage.getItem(ACCESS_KEY) !== null;
  }

  public clear(): void {
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }
}
