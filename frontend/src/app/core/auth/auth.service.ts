import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AccessTokenClaims, Role, decodeAccessToken } from './jwt';
import { deriveCodeChallenge, generateCodeVerifier } from './pkce';
import { AuthorizeRequest, AuthorizeResponse, TokenRequest, TokenResponse } from './auth.types';
import { TokenStorageService } from './token-storage.service';

/**
 * Sesión OAuth2 Authorization Code + PKCE contra el Gateway (Principio VII).
 *
 * El flujo NO redirige de navegador: `login()` hace de punta a punta
 * `POST /oauth/authorize` (credenciales + PKCE → code) seguido de
 * `POST /oauth/token` (code → tokens) en la misma llamada, porque así es como
 * el Gateway lo expone — ver `core/auth/pkce.ts`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  // `inject()` en vez de propiedades de parámetro del constructor: los
  // inicializadores de campo (incluido `claimsSignal` más abajo) se ejecutan
  // ANTES que el cuerpo del constructor, así que una propiedad de parámetro
  // todavía sería `undefined` cuando `readClaims()` la usara.
  private readonly http = inject(HttpClient);
  private readonly tokens = inject(TokenStorageService);

  private readonly claimsSignal = signal<AccessTokenClaims | null>(this.readClaims());

  public readonly isAuthenticated = computed(() => {
    const claims = this.claimsSignal();
    return claims !== null && claims.exp * 1000 > Date.now();
  });

  public readonly roles = computed<Role[]>(() => this.claimsSignal()?.roles ?? []);
  public readonly userId = computed<string | null>(() => this.claimsSignal()?.sub ?? null);

  private readClaims(): AccessTokenClaims | null {
    const token = this.tokens.getAccessToken();
    return token === null ? null : decodeAccessToken(token);
  }

  /**
   * @throws vía el observable: 401 `invalid_grant` (credenciales inválidas) o
   * 403 `email_unverified` (falta verificar correo, FR-002) — el llamador
   * distingue por `error.error.code` (ver {@link ErrorBody}).
   */
  public login(email: string, password: string): Observable<void> {
    const verifier = generateCodeVerifier();

    return new Observable<void>((subscriber) => {
      deriveCodeChallenge(verifier)
        .then((challenge) => {
          const authorize: AuthorizeRequest = {
            email,
            password,
            client_id: environment.oauth.clientId,
            redirect_uri: environment.oauth.redirectUri,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            scopes: environment.oauth.scopes,
          };

          this.http.post<AuthorizeResponse>(`${environment.apiBaseUrl}/oauth/authorize`, authorize).subscribe({
            next: (authResp) => {
              const tokenReq: TokenRequest = {
                grant_type: 'authorization_code',
                code: authResp.code,
                code_verifier: verifier,
                client_id: environment.oauth.clientId,
                redirect_uri: environment.oauth.redirectUri,
              };
              this.http.post<TokenResponse>(`${environment.apiBaseUrl}/oauth/token`, tokenReq).subscribe({
                next: (tokenResp) => {
                  this.storeTokens(tokenResp);
                  subscriber.next();
                  subscriber.complete();
                },
                error: (err: unknown) => subscriber.error(err),
              });
            },
            error: (err: unknown) => subscriber.error(err),
          });
        })
        .catch((err: unknown) => subscriber.error(err));
    });
  }

  /** Refresco silencioso (usado por el interceptor JWT ante un 401). */
  public refresh(): Observable<void> {
    const refreshToken = this.tokens.getRefreshToken();
    if (refreshToken === null) {
      throw new Error('auth: no hay refresh_token almacenado');
    }
    const body: TokenRequest = { grant_type: 'refresh_token', refresh_token: refreshToken };
    return this.http.post<TokenResponse>(`${environment.apiBaseUrl}/oauth/token`, body).pipe(
      tap((resp) => this.storeTokens(resp)),
      map(() => undefined),
    );
  }

  public logout(): Observable<void> {
    return this.http.post<void>(`${environment.apiBaseUrl}/auth/logout`, {}).pipe(
      tap({
        next: () => this.clearSession(),
        error: () => this.clearSession(),
      }),
    );
  }

  public clearSession(): void {
    this.tokens.clear();
    this.claimsSignal.set(null);
  }

  public hasRole(...allowed: Role[]): boolean {
    const mine = this.roles();
    return allowed.some((role) => mine.includes(role));
  }

  private storeTokens(resp: TokenResponse): void {
    this.tokens.save({
      accessToken: resp.access_token,
      refreshToken: resp.refresh_token ?? this.tokens.getRefreshToken() ?? '',
    });
    this.claimsSignal.set(decodeAccessToken(resp.access_token));
  }
}
