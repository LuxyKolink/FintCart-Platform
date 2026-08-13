/** DTOs del borde de identidad — espejo exacto de `services/api-gateway/internal/handler/types.go`. */

export interface RegisterRequest {
  email: string;
  password: string;
  display_name: string;
}

export interface VerifyEmailRequest {
  user_id: string;
  verification_token: string;
}

export interface SagaAccepted {
  saga_id: string;
}

export interface AuthorizeRequest {
  email: string;
  password: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  scopes: string[];
}

export interface AuthorizeResponse {
  code: string;
  redirect_uri: string;
}

export interface TokenRequest {
  grant_type: 'authorization_code' | 'refresh_token';
  code?: string;
  code_verifier?: string;
  client_id?: string;
  redirect_uri?: string;
  refresh_token?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

export interface ErrorBody {
  code: string;
  message: string;
}
