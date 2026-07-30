package server

import (
	"context"
	"fmt"
	"time"
)

// Flujo Authorization Code + PKCE (Principio VII, research D-05).
//
// El cliente de cara al usuario es la SPA: un cliente PÚBLICO, sin secreto. Todo
// lo que este archivo hace deriva de esa realidad — sin secreto de cliente, lo
// único que impide que quien intercepte un `authorization_code` lo canjee es PKCE,
// así que `code_challenge_method` distinto de `S256` no se acepta y el
// `code_verifier` se verifica siempre.

// AccessClaims es el contenido verificado de un access token.
type AccessClaims struct {
	UserID    string
	JTI       string
	Roles     []string
	Scopes    []string
	ExpiresAt time.Time
}

// AccessToken es un access token recién emitido.
//
// Lleva el `JTI` y el `ExpiresAt` junto al texto porque el llamador los necesita
// sin volver a parsear el token: la revocación se indexa por `jti` y el TTL de la
// blacklist es la vida residual, que se calcula con `ExpiresAt`.
type AccessToken struct {
	Raw       string
	JTI       string
	ExpiresAt time.Time
}

// TokenPair es lo que devuelve un intercambio o una renovación.
type TokenPair struct {
	AccessToken  string
	RefreshToken string
	TokenType    string
	ExpiresIn    int32
}

// TokenMaker es el puerto de firma y verificación de JWT (lo implementa
// `internal/token`, T048).
//
// `Parse` DEBE verificar la firma y la expiración, no solo decodificar. Es la
// distinción entre validar un token y leerlo: un JWT decodificado sin verificar es
// un objeto JSON que el atacante escribió.
type TokenMaker interface {
	Issue(userID string, roles, scopes []string) (AccessToken, error)
	Parse(raw string) (AccessClaims, error)
}

// AuthContextProvider resuelve los roles del usuario para poblar los claims.
//
// Los roles los posee el Servicio de Usuarios (Principio III), así que se piden
// por gRPC y NO se leen de `users_db`. Es un puerto estrecho —solo roles— y no el
// cliente completo de Usuarios: este servicio no tiene ninguna razón para poder
// leer perfiles, y el tipo lo hace imposible en lugar de confiar en que nadie lo
// intente.
type AuthContextProvider interface {
	Roles(ctx context.Context, userID string) ([]string, error)
}

// IssueAuthorizationCode emite un código de un solo uso tras autenticar.
func (s *Server) IssueAuthorizationCode(
	_ context.Context,
	userID, clientID, redirectURI, codeChallenge, codeChallengeMethod string,
	scopes []string,
) (string, error) {
	if _, err := parseUserID(userID); err != nil {
		return "", err
	}
	if codeChallengeMethod != "S256" {
		return "", fmt.Errorf("%w: code_challenge_method debe ser S256, no %q",
			ErrInvalidArgument, codeChallengeMethod)
	}
	// T050 implementa:
	//   1. Verificar que `clientID` existe, es público y que `redirectURI` está en
	//      su lista registrada. La comparación de la URI debe ser EXACTA, no por
	//      prefijo: un prefijo permite redirigir a un subpath controlado por el
	//      atacante.
	//   2. Generar el código con un generador criptográficamente seguro.
	//   3. Persistirlo con TTL ≤ 60 s (el CHECK del esquema lo exige).
	_, _ = clientID, redirectURI
	_, _ = codeChallenge, scopes
	return "", ErrNotImplemented
}

// ExchangeCode canjea el código y el `code_verifier` por un par de tokens.
func (s *Server) ExchangeCode(_ context.Context, code, codeVerifier, clientID, redirectURI string) (TokenPair, error) {
	// T050 implementa:
	//   1. `store.ConsumeAuthCode` (atómico: marca y devuelve, ver su comentario).
	//   2. Verificar PKCE: BASE64URL(SHA256(code_verifier)) == code_challenge, con
	//      comparación en tiempo constante.
	//   3. Comprobar que `clientID` y `redirectURI` coinciden con los del código —
	//      si no se comprueban, PKCE protege el canje pero no a quién se le entrega.
	//   4. Emitir el access token con los roles de `authctx` y guardar el refresh.
	_, _ = code, codeVerifier
	_, _ = clientID, redirectURI
	return TokenPair{}, ErrNotImplemented
}

// RefreshToken rota el refresh token y emite un access token nuevo.
//
// La rotación es obligatoria (D-05): el refresh presentado queda inválido en el
// mismo acto. Sin rotación, un refresh token filtrado es una sesión perpetua que
// nadie puede cerrar.
func (s *Server) RefreshToken(_ context.Context, refreshToken string) (TokenPair, error) {
	if refreshToken == "" {
		return TokenPair{}, fmt.Errorf("%w: refresh_token vacío", ErrInvalidArgument)
	}
	// T050 implementa el `LookupRefreshToken` + `RotateRefreshToken` + emisión, y
	// la detección de reutilización descrita en `storer.RedisStore`.
	return TokenPair{}, ErrNotImplemented
}
