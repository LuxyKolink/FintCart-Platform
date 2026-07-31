// Adaptadores de autenticación del borde: verificación de JWT y consulta de la
// blacklist de revocación (T056, Principio VII).
//
// Están en su propio paquete y no en `internal/handler` por la misma razón que
// `internal/ratelimit`: son infraestructura —criptografía y Redis— detrás de los
// puertos que el handler declara. Con esta separación, `handler` sigue sin importar
// `redis` ni `jwt`, y sus middlewares se prueban con dobles de dos métodos.
//
// El Gateway VERIFICA tokens, nunca los emite. Esa asimetría es lo que permite que un
// Gateway comprometido no pueda fabricar credenciales — siempre que la clave sea
// asimétrica; ver la salvedad de [JWTVerifier].
package authn

import (
	"context"
	"errors"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"

	"github.com/fintcart/platform/services/api-gateway/internal/handler"
)

// ErrInvalidToken se devuelve cuando la firma, el emisor, la audiencia o la
// expiración no cuadran.
//
// Es un único error para los cuatro casos: distinguirlos le diría a quien prueba
// tokens al azar cuál de sus intentos se acercó más.
var ErrInvalidToken = errors.New("authn: token inválido")

// Algorithm fija con qué algoritmo se verifica la firma.
//
// Existe como tipo explícito porque el algoritmo NO puede salir del token. La
// cabecera `alg` la escribe quien envía la petición, y aceptarla es el ataque
// clásico: `alg: none` deja el token sin firma, y degradar RS256 a HS256 permite
// usar la clave PÚBLICA —que es pública— como secreto HMAC para firmar lo que sea.
type Algorithm string

const (
	// AlgHS256 es simétrico: la misma clave firma y verifica.
	AlgHS256 Algorithm = "HS256"
	// AlgRS256 es asimétrico: aquí solo llega la clave pública.
	AlgRS256 Algorithm = "RS256"
)

// Emisor y audiencia que el Gateway exige en cada token.
//
// Son copia literal de `token.Issuer` y `token.Audience` del Servidor de
// Autenticación, y están duplicados porque los dos servicios son módulos Go
// independientes: compartirlos obligaría a una dependencia de código entre servicios,
// que es justo lo que el Principio III y la separación por módulos evitan. La
// superficie compartida es `contracts/`, no el código.
//
// Si algún día dejan de coincidir, el síntoma es inequívoco y ruidoso —ningún token
// pasa el borde— y no una degradación silenciosa de seguridad.
const (
	expectedIssuer   = "fintcart-auth"
	expectedAudience = "fintcart-api"
)

// JWTVerifier implementa `handler.TokenVerifier`.
//
// SALVEDAD PENDIENTE (T048/T056): hoy `dev/docker-compose.yaml` pasa el mismo
// `JWT_SIGNING_KEY` al Servidor de Autenticación y al Gateway, es decir, HS256. Con
// clave simétrica, quien puede verificar puede también FIRMAR, así que el Gateway
// —el componente expuesto a Internet— tiene la capacidad de emitir tokens de
// administrador. Funciona para desarrollo y no es aceptable fuera de él.
//
// El destino es RS256 con `JWT_PUBLIC_KEY` (la variable que nombra T035): Auth
// guarda la privada y el Gateway solo recibe la pública. El campo [Algorithm] existe
// para que el cambio sea de configuración y no de código, y para que el algoritmo
// aceptado quede fijado por el DESPLIEGUE en lugar de por el token.
type JWTVerifier struct {
	alg Algorithm
	// key es `[]byte` con HS256 y `*rsa.PublicKey` con RS256. Se guarda ya resuelta
	// —no como el texto de la variable de entorno— para que un PEM mal formado se
	// detecte al arrancar y no en la primera petición de cada réplica.
	key any
}

// ErrEmptyKey rechaza una clave de verificación vacía.
var ErrEmptyKey = errors.New("authn: la clave de verificación está vacía")

// ErrUnsupportedAlgorithm rechaza un algoritmo que este borde no sabe verificar.
var ErrUnsupportedAlgorithm = errors.New("authn: algoritmo de verificación no soportado")

// NewJWTVerifier construye el verificador.
//
// Falla al arrancar si la clave está vacía o si el PEM no es una clave pública RSA
// legible. La alternativa —arrancar y rechazar todo con 401— produciría el síntoma
// «nadie puede entrar» sin apuntar a la variable de entorno que falta.
func NewJWTVerifier(alg Algorithm, key string) (*JWTVerifier, error) {
	if key == "" {
		return nil, fmt.Errorf("%w (algoritmo %s)", ErrEmptyKey, alg)
	}

	switch alg {
	case AlgHS256:
		// Longitud mínima igual a la que exige `token.NewJWTMaker` en Auth: una clave
		// HMAC más corta que la salida de SHA-256 reduce el trabajo de un ataque por
		// fuerza bruta sobre la firma. Los dos extremos comparten la clave, así que
		// también deben compartir el mínimo — si solo lo exigiera Auth, un Gateway
		// configurado con una clave corta la aceptaría sin protestar.
		if len(key) < minHMACKeyBytes {
			return nil, fmt.Errorf("%w: se requieren al menos %d bytes para HS256", ErrEmptyKey, minHMACKeyBytes)
		}
		return &JWTVerifier{alg: alg, key: []byte(key)}, nil
	case AlgRS256:
		pub, err := jwt.ParseRSAPublicKeyFromPEM([]byte(key))
		if err != nil {
			return nil, fmt.Errorf("interpretar JWT_PUBLIC_KEY como clave pública RSA en PEM: %w", err)
		}
		return &JWTVerifier{alg: alg, key: pub}, nil
	default:
		return nil, fmt.Errorf("%w: %s", ErrUnsupportedAlgorithm, alg)
	}
}

// minHMACKeyBytes es el mínimo de una clave simétrica, espejo del de Auth.
const minHMACKeyBytes = 32

// gatewayClaims es la forma del token tal como la lee el borde.
//
// Es una declaración PROPIA y no un import de `auth-server/internal/token`: los
// nombres de los claims (`roles`, `scopes`) son parte del contrato entre servicios, y
// duplicar cuatro etiquetas JSON cuesta menos que acoplar dos módulos.
type gatewayClaims struct {
	jwt.RegisteredClaims

	Roles  []string `json:"roles,omitempty"`
	Scopes []string `json:"scopes,omitempty"`
}

// Verify comprueba firma, emisor, audiencia y expiración, y devuelve los claims.
//
// Las cuatro opciones de validación son deliberadas y ninguna es redundante:
//
//   - `WithValidMethods` fija el algoritmo desde el DESPLIEGUE. Sin ella, la librería
//     usa el `alg` que trae el token, y ahí viven los dos ataques clásicos: `alg: none`
//     (token sin firma) y degradar RS256 a HS256 para firmar con la clave pública
//     usada como secreto HMAC.
//   - `WithIssuer` y `WithAudience` rechazan un token válido pero emitido para otro
//     destinatario: sin `aud`, un token M2M de un cliente cualquiera abriría el borde
//     de usuario final.
//   - `WithExpirationRequired` rechaza un token SIN `exp`. Por defecto la librería
//     trata la ausencia de `exp` como «no caduca», que convertiría un token filtrado
//     en una sesión perpetua.
func (v *JWTVerifier) Verify(raw string) (handler.Claims, error) {
	claims := &gatewayClaims{}
	parsed, err := jwt.ParseWithClaims(raw, claims,
		func(*jwt.Token) (any, error) { return v.key, nil },
		jwt.WithValidMethods([]string{string(v.alg)}),
		jwt.WithIssuer(expectedIssuer),
		jwt.WithAudience(expectedAudience),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		// El motivo concreto se envuelve para el log y se colapsa en un único centinela
		// para el cliente: el middleware responde siempre «token inválido», de modo que
		// probar tokens al azar no revela cuál de las comprobaciones falló.
		return handler.Claims{}, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}
	if !parsed.Valid {
		return handler.Claims{}, ErrInvalidToken
	}

	// `sub` y `jti` vacíos se rechazan aquí y no más adelante. Un `sub` vacío llegaría
	// al servicio de dominio como «el usuario cuyo id es la cadena vacía» y acabaría en
	// un WHERE; un `jti` vacío haría la sesión IMPOSIBLE de revocar (FR-004), porque no
	// habría nada que poner en la blacklist.
	if claims.Subject == "" {
		return handler.Claims{}, fmt.Errorf("%w: falta el claim sub", ErrInvalidToken)
	}
	if claims.ID == "" {
		return handler.Claims{}, fmt.Errorf("%w: falta el claim jti", ErrInvalidToken)
	}

	return handler.Claims{
		UserID: claims.Subject,
		Roles:  claims.Roles,
		JTI:    claims.ID,
		Scopes: claims.Scopes,
	}, nil
}

// Comprobación en tiempo de compilación del implementador.
var _ handler.TokenVerifier = (*JWTVerifier)(nil)

// RedisBlacklist implementa `handler.BlacklistChecker` (FR-004).
//
// Consulta Redis directamente en lugar de llamar a `Auth.Introspect` por gRPC: está
// en el camino crítico de CADA petición autenticada, y un salto de red extra por
// petición se paga en toda la plataforma. La contrapartida es el acoplamiento al
// formato de clave, que por eso está declarado en una constante de este archivo y en
// `services/auth-server/internal/storer/redis_store.go`, y en ningún otro sitio.
//
// Es uno de los DOS usos permitidos de Redis en el Gateway (Principio IV); el otro es
// `internal/ratelimit`.
type RedisBlacklist struct {
	client redis.UniversalClient
}

// blacklistKeyPrefix es el prefijo que escribe `Auth.Revoke`.
const blacklistKeyPrefix = "blacklist:"

// NewRedisBlacklist envuelve un cliente ya conectado.
func NewRedisBlacklist(client redis.UniversalClient) *RedisBlacklist {
	return &RedisBlacklist{client: client}
}

// IsBlacklisted responde si el `jti` fue revocado.
//
// Un error de Redis se PROPAGA y no se traduce a «no revocado». Tratar el fallo como
// «adelante» convertiría una caída de Redis en la reactivación silenciosa de todas
// las sesiones cerradas — el middleware es quien decide qué hacer con el error, y su
// decisión es rechazar (fail closed), igual que el rate limiter.
func (b *RedisBlacklist) IsBlacklisted(ctx context.Context, jti string) (bool, error) {
	if jti == "" {
		// Un token sin `jti` no se puede revocar, así que aceptarlo dejaría una sesión
		// imposible de cerrar. Se rechaza como si estuviera revocado.
		return true, fmt.Errorf("%w: falta el jti", ErrInvalidToken)
	}

	n, err := b.client.Exists(ctx, blacklistKeyPrefix+jti).Result()
	if err != nil {
		return false, fmt.Errorf("consultar la blacklist del jti %s: %w", jti, err)
	}
	return n > 0, nil
}

// Comprobación en tiempo de compilación del implementador.
var _ handler.BlacklistChecker = (*RedisBlacklist)(nil)
