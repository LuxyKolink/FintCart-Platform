/** Forma de los claims que firma `services/auth-server/internal/token/claims.go`. */
export interface AccessTokenClaims {
  sub: string;
  exp: number;
  iat: number;
  roles: Role[];
  scopes?: string[];
}

/** `usuario_final | editor | coordinador_editorial` (users.proto). */
export type Role = 'usuario_final' | 'editor' | 'coordinador_editorial';

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  return atob(padded);
}

/**
 * Decodifica (sin verificar firma — la SPA no tiene la clave) el payload de un
 * JWT para leer `roles` y `exp`. La verificación de firma es responsabilidad
 * del API Gateway en cada petición; aquí solo se lee lo público.
 */
export function decodeAccessToken(token: string): AccessTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const json = base64UrlDecode(parts[1]);
    return JSON.parse(json) as AccessTokenClaims;
  } catch {
    return null;
  }
}
