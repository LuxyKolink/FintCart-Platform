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

	"github.com/redis/go-redis/v9"

	"github.com/fintcart/platform/services/api-gateway/internal/handler"
)

// ErrNotImplemented marca lo que llega con T056.
//
// En un verificador de tokens, un stub permisivo es un agujero abierto: si `Verify`
// devolviera unos `Claims` vacíos y `nil`, cualquier cadena en la cabecera
// `Authorization` pasaría por un token válido. Devolver error deja el borde CERRADO
// mientras la implementación no esté.
var ErrNotImplemented = errors.New("authn: no implementado")

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
	key []byte
}

// ErrEmptyKey rechaza una clave de verificación vacía.
var ErrEmptyKey = errors.New("authn: la clave de verificación está vacía")

// NewJWTVerifier construye el verificador.
//
// Falla al arrancar si la clave está vacía. La alternativa —arrancar y rechazar todo
// con 401— produciría el síntoma «nadie puede entrar» sin apuntar a la variable de
// entorno que falta.
func NewJWTVerifier(alg Algorithm, key string) (*JWTVerifier, error) {
	if key == "" {
		return nil, fmt.Errorf("%w (algoritmo %s)", ErrEmptyKey, alg)
	}
	return &JWTVerifier{alg: alg, key: []byte(key)}, nil
}

// Verify comprueba firma, emisor, audiencia y expiración, y devuelve los claims.
//
// T056: parsear con `jwt.ParseWithClaims` y `jwt.WithValidMethods([]string{string(v.alg)})`.
// Esa opción es la que impide la confusión de algoritmo descrita en [Algorithm].
func (v *JWTVerifier) Verify(_ string) (handler.Claims, error) {
	_ = v.key
	_ = v.alg
	return handler.Claims{}, ErrNotImplemented
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
