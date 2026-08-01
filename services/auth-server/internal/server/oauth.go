package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/fintcart/platform/services/auth-server/internal/storer"
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

// Parámetros del flujo.
const (
	// tokenTypeBearer es el `token_type` del RFC 6749 §7.1.
	tokenTypeBearer = "Bearer"

	// grantAuthorizationCode y grantRefreshToken son los `grant_types` que un cliente
	// debe declarar para usar cada flujo.
	grantAuthorizationCode = "authorization_code"
	grantRefreshToken      = "refresh_token"
	grantClientCredentials = "client_credentials"

	// challengeMethodS256 es el ÚNICO método PKCE aceptado. `plain` está excluido a
	// propósito: envía el verificador tal cual, así que quien intercepte la petición
	// de autorización puede canjear el código igual que si PKCE no existiera.
	challengeMethodS256 = "S256"

	// authCodeTTL es la vida de un código de autorización.
	//
	// El CHECK `authorization_codes_ttl_short` exige `expires_at <= created_at + 60s`,
	// y `created_at` lo pone el reloj de PostgreSQL mientras que este valor sale del
	// reloj del proceso. Los 15 segundos de margen absorben la deriva entre los dos:
	// con 60 exactos, un proceso adelantado medio segundo vería sus códigos
	// rechazados por el CHECK, y el síntoma sería «el login falla a veces».
	authCodeTTL = 45 * time.Second

	// RefreshTokenTTL es la vida de un refresh token (D-05).
	//
	// Es mucho más larga que la del access token, pero el token se ROTA en cada uso:
	// cada renovación invalida el anterior, así que reutilizar uno ya canjeado delata
	// el robo y permite cortar la familia entera.
	RefreshTokenTTL = 30 * 24 * time.Hour

	// secretBytes es el tamaño del material aleatorio de códigos y refresh tokens.
	// 32 bytes = 256 bits: fuera del alcance de cualquier búsqueda exhaustiva.
	secretBytes = 32
)

// ErrPKCEVerificationFailed marca un `code_verifier` que no corresponde al
// `code_challenge` registrado.
//
// Es un error propio porque señala algo distinto de un código caducado: significa
// que quien canjea NO es quien inició el flujo. Hacia el cliente se responde igual
// que en cualquier otro fallo del canje (ver el mapeo de `handler`), pero el log
// tiene que poder distinguirlo — es la señal de que un código fue interceptado.
var ErrPKCEVerificationFailed = errors.New("server: la verificación PKCE falló")

// IssueAuthorizationCode emite un código de un solo uso tras autenticar.
//
// Presupone que el usuario YA se autenticó: esta función no comprueba contraseñas,
// solo materializa el resultado de esa autenticación en un código canjeable.
func (s *Server) IssueAuthorizationCode(
	ctx context.Context,
	userID, clientID, redirectURI, codeChallenge, codeChallengeMethod string,
	scopes []string,
) (string, error) {
	uid, err := parseUserID(userID)
	if err != nil {
		return "", err
	}
	if codeChallengeMethod != challengeMethodS256 {
		return "", fmt.Errorf("%w: code_challenge_method debe ser S256, no %q",
			ErrInvalidArgument, codeChallengeMethod)
	}
	if codeChallenge == "" {
		return "", fmt.Errorf("%w: code_challenge vacío", ErrInvalidArgument)
	}

	// El estado de la cuenta se comprueba antes de emitir nada (FR-002). Un código
	// de autorización es un token en todo lo que importa: quien lo tiene obtiene una
	// sesión, y dejar que se emita para una cuenta sin verificar convertiría la
	// verificación de correo en un trámite que se puede saltar. Va después de las
	// comprobaciones gratuitas —método y challenge— para no leer la base por una
	// petición que ya es inválida.
	if err := s.assertIssuable(ctx, uid); err != nil {
		return "", err
	}

	client, err := s.store.GetOAuthClient(ctx, clientID)
	if err != nil {
		return "", fmt.Errorf("leer cliente %s: %w", clientID, err)
	}
	if !slices.Contains(client.GrantTypes, grantAuthorizationCode) {
		return "", fmt.Errorf("%w: el cliente %s no admite authorization_code", ErrInvalidArgument, clientID)
	}

	// La `redirect_uri` se compara EXACTA contra la lista registrada, no por prefijo
	// ni por dominio. Con una comparación por prefijo, un cliente que registre
	// `https://app.fintcart.co/cb` aceptaría `https://app.fintcart.co/cb.atacante.com`
	// o `https://app.fintcart.co/cb/../evil`, y el código se entregaría a otro sitio.
	if !slices.Contains(client.RedirectURIs, redirectURI) {
		return "", fmt.Errorf("%w: redirect_uri no registrada para el cliente %s", ErrInvalidArgument, clientID)
	}

	// Los scopes pedidos tienen que ser un subconjunto de los que el cliente tiene
	// concedidos. Sin esta comprobación, cualquiera podría pedir un scope que el
	// cliente nunca fue autorizado a usar simplemente escribiéndolo en la URL.
	if err := checkScopes(scopes, client.Scopes); err != nil {
		return "", err
	}

	code, err := randomSecret()
	if err != nil {
		return "", fmt.Errorf("generar el código de autorización: %w", err)
	}

	row := storer.AuthCodeRow{
		ID:                  uuid.New(),
		Code:                code,
		ClientID:            clientID,
		UserID:              uid,
		CodeChallenge:       codeChallenge,
		CodeChallengeMethod: codeChallengeMethod,
		RedirectURI:         redirectURI,
		Scopes:              scopes,
		ExpiresAt:           time.Now().UTC().Add(authCodeTTL),
	}
	if err := s.store.InsertAuthCode(ctx, row); err != nil {
		return "", fmt.Errorf("persistir el código de autorización: %w", err)
	}
	return code, nil
}

// ExchangeCode canjea el código y el `code_verifier` por un par de tokens.
func (s *Server) ExchangeCode(ctx context.Context, code, codeVerifier, clientID, redirectURI string) (TokenPair, error) {
	if code == "" || codeVerifier == "" {
		return TokenPair{}, fmt.Errorf("%w: code y code_verifier son obligatorios", ErrInvalidArgument)
	}

	// El consumo es ATÓMICO: marca y devuelve en una sola sentencia. Un `Get` seguido
	// de un `MarkConsumed` dejaría una ventana en la que dos canjes concurrentes del
	// mismo código obtienen tokens los dos — justo el ataque que PKCE cierra.
	row, err := s.store.ConsumeAuthCode(ctx, code)
	if err != nil {
		return TokenPair{}, fmt.Errorf("consumir el código: %w", err)
	}

	// PKCE: BASE64URL(SHA256(code_verifier)) tiene que coincidir con el challenge
	// registrado. Es lo ÚNICO que ata el canje a quien inició el flujo, porque el
	// cliente es público y no tiene secreto con el que autenticarse.
	if !verifyPKCE(row.CodeChallenge, codeVerifier) {
		return TokenPair{}, ErrPKCEVerificationFailed
	}

	// El cliente y la `redirect_uri` deben coincidir con los del código. PKCE protege
	// el canje pero no dice A QUIÉN se entrega: sin estas dos comprobaciones, un
	// cliente distinto podría canjear un código emitido para otro.
	if row.ClientID != clientID {
		return TokenPair{}, fmt.Errorf("%w: el código no pertenece al cliente %s", ErrInvalidArgument, clientID)
	}
	if row.RedirectURI != redirectURI {
		return TokenPair{}, fmt.Errorf("%w: redirect_uri distinta de la del código", ErrInvalidArgument)
	}

	// El estado de la cuenta se comprueba EN EL CANJE, no solo al autenticar: entre
	// la emisión del código y su canje caben 45 segundos, y una anonimización
	// (FR-030) o el mero hecho de no haber verificado el correo (FR-002) en ese hueco
	// no pueden acabar en un token válido.
	if err := s.assertIssuable(ctx, row.UserID); err != nil {
		return TokenPair{}, err
	}

	return s.issuePair(ctx, row.UserID, row.Scopes)
}

// RefreshToken rota el refresh token y emite un access token nuevo.
//
// La rotación es obligatoria (D-05): el refresh presentado queda inválido en el
// mismo acto. Sin rotación, un refresh token filtrado es una sesión perpetua que
// nadie puede cerrar.
func (s *Server) RefreshToken(ctx context.Context, refreshToken string) (TokenPair, error) {
	if refreshToken == "" {
		return TokenPair{}, fmt.Errorf("%w: refresh_token vacío", ErrInvalidArgument)
	}

	oldID := refreshTokenID(refreshToken)

	userID, err := s.tokens.LookupRefreshToken(ctx, oldID)
	switch {
	case errors.Is(err, storer.ErrTokenReuse):
		// DETECCIÓN DE ROBO (D-05). Se presentó un token que ya fue rotado, y eso solo
		// puede venir de quien guardó una copia. A partir de aquí el usuario legítimo y
		// el ladrón son indistinguibles, así que se corta la familia ENTERA: los dos
		// tendrán que autenticarse de nuevo, y el ladrón se queda sin nada.
		//
		// La invalidación es lo primero que se hace y su fallo NO se traga: si no se
		// puede cortar la familia, el robo sigue vivo y hay que enterarse.
		if invErr := s.tokens.InvalidateFamily(ctx, userID); invErr != nil {
			return TokenPair{}, fmt.Errorf("invalidar familia tras reutilización: %w", errors.Join(err, invErr))
		}
		return TokenPair{}, fmt.Errorf("reutilización de refresh token del usuario %s: %w", userID, err)
	case err != nil:
		// Caducado, inexistente o de una familia ya cortada: para el cliente son el
		// mismo caso, y sale como `ErrUnauthenticated` —no como «no encontrado»—
		// porque presentar un refresh que no vale es un fallo de autenticación, no un
		// recurso ausente. Distinguirlos le diría a quien prueba tokens cuál de ellos
		// llegó a existir. La causa concreta sí va al log, envuelta.
		return TokenPair{}, fmt.Errorf("%w: consultar refresh token: %w", ErrUnauthenticated, err)
	}

	// Renovar es EMITIR, así que la cuenta vuelve a comprobarse (FR-002, FR-030). Un
	// refresh token vive treinta días: sin esta comprobación, una cuenta anonimizada
	// el martes seguiría produciendo access tokens válidos hasta que su refresh
	// caducara, y la anonimización sería una promesa a plazo en lugar de un efecto.
	if err := s.assertIssuable(ctx, userID); err != nil {
		return TokenPair{}, err
	}

	newToken, err := randomSecret()
	if err != nil {
		return TokenPair{}, fmt.Errorf("generar el refresh token: %w", err)
	}

	// La rotación va ANTES de emitir el access token. Si fuera al revés y la rotación
	// fallara, el cliente se quedaría con un access token válido y un refresh que ya
	// creería rotado, sin forma de saber cuál de los dos vale.
	if err := s.tokens.RotateRefreshToken(ctx, oldID, refreshTokenID(newToken), userID, RefreshTokenTTL); err != nil {
		return TokenPair{}, fmt.Errorf("rotar refresh token: %w", err)
	}

	access, err := s.newAccessToken(ctx, userID.String(), nil)
	if err != nil {
		return TokenPair{}, err
	}

	return TokenPair{
		AccessToken:  access.Raw,
		RefreshToken: newToken,
		TokenType:    tokenTypeBearer,
		ExpiresIn:    expiresInSeconds(access),
	}, nil
}

// issuePair emite el par access + refresh para un usuario ya verificado.
//
// Lo comparten [Server.ExchangeCode] y el resto de flujos que terminan en una
// sesión, para que la forma del par —y en particular el hecho de que el refresh se
// guarde con su TTL antes de devolverlo— sea idéntica en todos.
func (s *Server) issuePair(ctx context.Context, userID uuid.UUID, scopes []string) (TokenPair, error) {
	access, err := s.newAccessToken(ctx, userID.String(), scopes)
	if err != nil {
		return TokenPair{}, err
	}

	refresh, err := randomSecret()
	if err != nil {
		return TokenPair{}, fmt.Errorf("generar el refresh token: %w", err)
	}
	if err := s.tokens.SaveRefreshToken(ctx, refreshTokenID(refresh), userID, RefreshTokenTTL); err != nil {
		return TokenPair{}, fmt.Errorf("guardar el refresh token: %w", err)
	}

	return TokenPair{
		AccessToken:  access.Raw,
		RefreshToken: refresh,
		TokenType:    tokenTypeBearer,
		ExpiresIn:    expiresInSeconds(access),
	}, nil
}

// newAccessToken resuelve los roles y firma el access token.
//
// Los roles se piden a Usuarios en CADA emisión y no se cachean: son la base de la
// autorización del borde, y un rol retirado tiene que dejar de aplicar en el
// siguiente token, no en el siguiente reinicio.
func (s *Server) newAccessToken(ctx context.Context, userID string, scopes []string) (AccessToken, error) {
	roles, err := s.authctx.Roles(ctx, userID)
	if err != nil {
		return AccessToken{}, fmt.Errorf("resolver roles de %s: %w", userID, err)
	}
	access, err := s.maker.Issue(userID, roles, scopes)
	if err != nil {
		return AccessToken{}, fmt.Errorf("emitir access token para %s: %w", userID, err)
	}
	return access, nil
}

// expiresInSeconds convierte el instante de expiración en los segundos del RFC 6749.
//
// Se calcula desde `time.Now` y no como una constante para que refleje la vida
// REAL que le queda al token que se está devolviendo: entre firmarlo y responder
// pasa tiempo, y un cliente que confíe en un valor fijo lo usaría un instante
// después de que caduque.
func expiresInSeconds(access AccessToken) int32 {
	remaining := time.Until(access.ExpiresAt).Seconds()
	if remaining < 0 {
		return 0
	}
	return int32(remaining)
}

// checkScopes exige que lo pedido sea subconjunto de lo concedido.
func checkScopes(requested, granted []string) error {
	for _, scope := range requested {
		if !slices.Contains(granted, scope) {
			return fmt.Errorf("%w: scope %q no concedido al cliente", ErrInvalidArgument, scope)
		}
	}
	return nil
}

// verifyPKCE comprueba BASE64URL(SHA256(verifier)) == challenge.
//
// La comparación es en tiempo constante. Con `==` sobre cadenas, el tiempo de
// respuesta revelaría cuánto prefijo del challenge se acertó, lo que permitiría
// reconstruirlo carácter a carácter con suficientes intentos.
//
// `RawURLEncoding` (base64url SIN relleno) es lo que fija el RFC 7636 §4.2.
func verifyPKCE(challenge, verifier string) bool {
	sum := sha256.Sum256([]byte(verifier))
	computed := base64.RawURLEncoding.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(computed), []byte(challenge)) == 1
}

// randomSecret genera material aleatorio en base64url sin relleno.
//
// `crypto/rand` y NUNCA `math/rand`: un código de autorización predecible se puede
// adivinar antes de que expire, y un refresh token predecible es una sesión ajena.
func randomSecret() (string, error) {
	buf := make([]byte, secretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("leer del generador aleatorio: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// refreshTokenID deriva el identificador con el que el refresh token se GUARDA.
//
// En Redis se almacena el SHA-256 del token, no el token. La diferencia importa:
// Redis no cifra en reposo y su contenido acaba en volcados y en copias de
// seguridad, así que guardar el valor tal cual convertiría cualquier lectura del
// almacén en un juego de sesiones utilizables. Con el hash, quien lea Redis no
// puede reconstruir el token que hay que presentar.
//
// No lleva sal ni Argon2 —a diferencia de una contraseña— porque el token tiene 256
// bits de entropía: no hay diccionario que recorrer ni tabla que precalcular, y un
// KDF costoso solo añadiría latencia a cada renovación.
func refreshTokenID(token string) string {
	return sha256Hex(token)
}

// sha256Hex es la forma en que este servicio guarda un secreto de ALTA ENTROPÍA
// generado por él mismo: el refresh token y el token de verificación de correo.
//
// Está compartida para que las dos usen literalmente la misma representación. Dos
// funciones equivalentes —una con `hex`, otra con `base64`— compilarían igual de
// bien y solo se delatarían el día que alguien comparase un hash escrito por una con
// el que espera la otra.
func sha256Hex(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
