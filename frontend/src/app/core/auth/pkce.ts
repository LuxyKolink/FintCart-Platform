/**
 * PKCE (RFC 7636) para el flujo Authorization Code de la SPA (Principio VII).
 *
 * No se usa `angular-oauth2-oidc` para esto: esa librería asume el flujo
 * estándar (`GET /authorize` con redirección de navegador). El Gateway sirve
 * en su lugar dos endpoints JSON (`POST /oauth/authorize`, `POST /oauth/token`)
 * porque el Servidor de Autenticación no expone REST (Principio II) — ver la
 * nota de T055 en `tasks.md` y el encabezado de `services/api-gateway/internal/handler/auth.go`.
 * El verificador y el challenge se generan aquí con Web Crypto.
 */

const VERIFIER_BYTES = 32;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(VERIFIER_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}
