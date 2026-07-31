package token

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/fintcart/platform/services/auth-server/internal/server"
)

// ErrInvalidToken se devuelve cuando la firma, el emisor, la audiencia o la
// expiración no cuadran.
//
// Es UN solo error para los cuatro casos, igual que `server.ErrUnauthenticated` lo
// es para el login: distinguir «firma inválida» de «expirado» le dice a quien prueba
// tokens al azar cuál de sus intentos se acercó más. La causa concreta va envuelta
// para el log, no para el cliente.
var ErrInvalidToken = errors.New("token: token inválido")

// ErrKeyTooShort rechaza claves que no aportan la entropía del algoritmo.
var ErrKeyTooShort = errors.New("token: la clave de firma es demasiado corta")

// minSigningKeyBytes son los 32 bytes que exige HS256.
//
// Una clave más corta que la salida de SHA-256 no debilita el hash pero sí acota el
// espacio de búsqueda de un ataque offline sobre un token capturado, y es un error de
// configuración que se detecta gratis al arrancar.
const minSigningKeyBytes = 32

// JWTMaker implementa [server.TokenMaker] con HMAC-SHA256.
//
// La clave es simétrica y la comparte con quien deba VERIFICAR. Eso es aceptable
// mientras el único verificador sea el propio Auth, y deja de serlo en cuanto el API
// Gateway verifica por su cuenta: con HS256, quien puede verificar puede también
// FIRMAR, así que un Gateway comprometido podría emitir tokens de administrador.
//
// PENDIENTE (T056): migrar a un par asimétrico (RS256/ES256) y publicar solo la clave
// pública al Gateway. El campo se llama `signingKey` y no `secret` porque ese es el
// destino; el cambio afecta además a `dev/docker-compose.yaml` —que hoy pasa el mismo
// `JWT_SIGNING_KEY` a los dos— y a la configuración de despliegue.
type JWTMaker struct {
	signingKey []byte
}

// NewJWTMaker valida la clave y construye el emisor.
//
// Se valida AQUÍ, en el arranque, y no en la primera emisión: un despliegue con una
// clave de ocho caracteres debe negarse a arrancar, no atender tráfico y firmar
// tokens débiles hasta que alguien lo audite.
//
// El error NO incluye la clave, solo su longitud: saber que es corta es lo que hace
// falta para arreglarlo, y es un dato que no sirve para nada más.
func NewJWTMaker(signingKey string) (*JWTMaker, error) {
	if len(signingKey) < minSigningKeyBytes {
		return nil, fmt.Errorf("%w: %d bytes, se requieren al menos %d",
			ErrKeyTooShort, len(signingKey), minSigningKeyBytes)
	}
	return &JWTMaker{signingKey: []byte(signingKey)}, nil
}

// Issue firma un access token nuevo.
//
// El `jti` es un UUIDv4: tiene que ser único —es la clave de la blacklist, y dos
// tokens con el mismo `jti` se revocarían juntos— e impredecible, porque un `jti`
// adivinable permitiría revocar la sesión de otro.
func (m *JWTMaker) Issue(userID string, roles, scopes []string) (server.AccessToken, error) {
	jti, err := uuid.NewRandom()
	if err != nil {
		return server.AccessToken{}, fmt.Errorf("token: generar el jti: %w", err)
	}

	now := time.Now().UTC()
	expiresAt := now.Add(AccessTokenTTL)

	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:   Issuer,
			Subject:  userID,
			Audience: jwt.ClaimStrings{Audience},
			// `iat` y `nbf` se fijan a `now`: sin `nbf`, un token robado antes de
			// entregarse sería utilizable de inmediato igualmente, pero tenerlo permite
			// emitir tokens diferidos sin cambiar el verificador.
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			ID:        jti.String(),
		},
		Roles:  roles,
		Scopes: scopes,
	}

	raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.signingKey)
	if err != nil {
		return server.AccessToken{}, fmt.Errorf("token: firmar el access token: %w", err)
	}

	// Se devuelven `JTI` y `ExpiresAt` junto al texto para que quien revoque no tenga
	// que volver a parsear el token: el TTL de la blacklist es la vida RESIDUAL, y
	// calcularla exige justamente estos dos datos.
	return server.AccessToken{Raw: raw, JTI: jti.String(), ExpiresAt: expiresAt}, nil
}

// Parse verifica un token y devuelve sus claims.
//
// Verifica, no decodifica. Un JWT decodificado sin comprobar la firma es un objeto
// JSON que escribió quien envió la petición.
func (m *JWTMaker) Parse(raw string) (server.AccessClaims, error) {
	claims := &Claims{}

	// `WithValidMethods` es la línea imprescindible. Sin ella, la librería acepta el
	// `alg` que declara el propio token: `alg: none` lo dejaría sin firma, y con
	// claves asimétricas permitiría degradar RS256 a HS256 usando la clave pública
	// como secreto.
	//
	// `WithIssuer`/`WithAudience` cierran el resto: sin `aud`, un token M2M valdría en
	// el borde de usuario final; sin `iss`, valdría uno de otro despliegue que
	// compartiera clave por accidente. `WithExpirationRequired` impide que un token
	// sin `exp` —que la librería consideraría válido para siempre— pase el filtro.
	parsed, err := jwt.ParseWithClaims(raw, claims,
		func(*jwt.Token) (any, error) { return m.signingKey, nil },
		jwt.WithValidMethods([]string{SigningMethod}),
		jwt.WithIssuer(Issuer),
		jwt.WithAudience(Audience),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		// La causa va envuelta (`%w` sobre `ErrInvalidToken` y sobre `err`) para que el
		// log tenga el detalle; quien llame solo debe comparar con `ErrInvalidToken`.
		return server.AccessClaims{}, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}
	if !parsed.Valid {
		return server.AccessClaims{}, ErrInvalidToken
	}

	// El `jti` se exige explícitamente: sin él el token no se puede revocar, así que
	// aceptarlo dejaría una sesión imposible de cerrar (FR-004).
	if claims.ID == "" {
		return server.AccessClaims{}, fmt.Errorf("%w: falta el jti", ErrInvalidToken)
	}
	if claims.ExpiresAt == nil {
		return server.AccessClaims{}, fmt.Errorf("%w: falta exp", ErrInvalidToken)
	}

	return server.AccessClaims{
		UserID:    claims.Subject,
		JTI:       claims.ID,
		Roles:     claims.Roles,
		Scopes:    claims.Scopes,
		ExpiresAt: claims.ExpiresAt.Time,
	}, nil
}

// Comprobación en tiempo de compilación del implementador.
var _ server.TokenMaker = (*JWTMaker)(nil)
