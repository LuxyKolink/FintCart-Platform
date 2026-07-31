// Rate limiting distribuido sobre Redis (Principio IV).
//
// Es UNO de los dos únicos usos de Redis permitidos en la plataforma; el otro es la
// blacklist de JWT y los refresh tokens en Auth. La restricción viene de que Redis no
// puede ser fuente de verdad de nada: si se cae y pierde su contenido, el efecto debe
// ser acotado —un rato sin límites— y nunca la pérdida de un dato.
//
// «Distribuido» es la parte que obliga a usar Redis en vez de un contador en memoria.
// El Gateway corre con ≥ 2 réplicas (D-12/SC-012), así que un límite por proceso sería
// en realidad N veces el límite configurado, y variable con el autoescalado. El estado
// compartido es lo único que hace que «100 peticiones por minuto» signifique eso.
package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// ErrInvalidKey rechaza una clave de límite vacía.
//
// Una clave vacía haría que TODO el tráfico sin identificar compartiera un mismo
// contador: bastarían unas pocas peticiones anónimas para agotar la cuota de todas
// las demás. Es un error de programación del llamante, no una condición de carrera.
var ErrInvalidKey = errors.New("ratelimit: clave vacía")

// ErrBackendUnavailable indica que Redis no respondió y la política es fail closed.
var ErrBackendUnavailable = errors.New("ratelimit: el backend no está disponible")

// Decision es el resultado de consultar el límite.
//
// Lleva `Remaining` y `RetryAfter` porque el borde los publica como cabeceras
// (`X-RateLimit-Remaining`, `Retry-After`): un 429 sin indicar cuándo reintentar
// invita al cliente a reintentar de inmediato, que es justo lo que el límite quiere
// evitar.
type Decision struct {
	Allowed    bool
	Remaining  int64
	RetryAfter time.Duration
}

// Limiter decide si una clave puede seguir consumiendo.
type Limiter interface {
	Allow(ctx context.Context, key string) (Decision, error)
}

// Config son los parámetros del límite, leídos del entorno en `main.go`
// (Principio X).
type Config struct {
	// Limit es el número de peticiones permitidas por ventana.
	Limit int64
	// Window es la duración de la ventana.
	Window time.Duration
	// FailOpen decide qué hacer si Redis no responde.
	//
	// El valor por defecto es `false` (fail CLOSED) y la elección importa: con
	// fail-open, una caída de Redis deja la plataforma sin ninguna protección de
	// tasa justo cuando ya está degradada, que es el momento en que más falta hace.
	// Un operador puede activarlo si prefiere disponibilidad, pero tiene que
	// pedirlo explícitamente.
	FailOpen bool
}

// RedisLimiter implementa [Limiter] con una ventana fija en Redis.
type RedisLimiter struct {
	client redis.UniversalClient
	cfg    Config
}

// NewRedisLimiter construye el limitador sobre un cliente ya conectado.
func NewRedisLimiter(client redis.UniversalClient, cfg Config) *RedisLimiter {
	return &RedisLimiter{client: client, cfg: cfg}
}

// prefijo de las claves de rate limiting.
const keyPrefix = "ratelimit:"

// allowScript incrementa el contador de la ventana y devuelve `{cuenta, ttl}`.
//
// Es un script y no un `INCR` seguido de un `EXPIRE` por una razón concreta: entre los
// dos comandos el proceso puede morir, la red puede cortarse o Redis puede reiniciarse,
// y la clave quedaría SIN TTL. Un contador sin caducidad no vuelve nunca a cero, así
// que el cliente afectado quedaría bloqueado de forma permanente —un fallo transitorio
// convertido en una expulsión definitiva, y silenciosa.
//
// El TTL se pone solo en el primer incremento (`== 1`). Renovarlo en cada petición
// convertiría la ventana fija en una ventana deslizante *hacia adelante*: quien siguiera
// pidiendo mantendría su propio contador vivo indefinidamente y nunca recuperaría cuota.
//
// Devuelve también el TTL para poder responder `Retry-After` sin una segunda ida y
// vuelta. El `-1` que Redis devuelve para «sin caducidad» se normaliza aquí, en el
// mismo sitio donde se garantiza que no puede pasar.
const allowScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  return {count, tonumber(ARGV[1])}
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`

// script compilado una sola vez. `redis.NewScript` usa EVALSHA y solo cae a EVAL si el
// servidor no tiene el script en caché, así que el cuerpo no viaja en cada petición.
var script = redis.NewScript(allowScript)

// Allow incrementa el contador de la ventana y decide.
//
// La ventana fija es deliberada frente a una deslizante: permite hasta el doble del
// límite en el cruce de dos ventanas, y a cambio cuesta un contador por clave en lugar
// de un sorted set con una entrada por petición. Para proteger de abuso, la
// aproximación sobra; si hiciera falta precisión, la decisión habría que revisarla.
//
// Cuenta SIEMPRE, también cuando la petición se rechaza. Lo contrario —no incrementar
// una vez superado el límite— dejaría que un cliente bloqueado recuperase cuota en
// cuanto expirara la ventana aunque no hubiera dejado de martillear, y elimina el
// incentivo a parar.
func (r *RedisLimiter) Allow(ctx context.Context, key string) (Decision, error) {
	if key == "" {
		return Decision{}, ErrInvalidKey
	}

	windowSeconds := int64(r.cfg.Window.Seconds())
	if windowSeconds < 1 {
		// Redis mide los TTL de `EXPIRE` en segundos enteros y trata el 0 como error.
		// Una ventana sub-segundo se redondea al mínimo representable en lugar de
		// producir claves inmortales.
		windowSeconds = 1
	}

	res, err := script.Run(ctx, r.client, []string{keyPrefix + key}, windowSeconds).Int64Slice()
	if err != nil {
		return r.onBackendFailure(err)
	}
	if len(res) != 2 {
		return r.onBackendFailure(fmt.Errorf("respuesta inesperada del script: %d valores", len(res)))
	}

	count, ttlSeconds := res[0], res[1]
	remaining := max(r.cfg.Limit-count, 0)

	if count > r.cfg.Limit {
		return Decision{
			Allowed:    false,
			Remaining:  0,
			RetryAfter: time.Duration(ttlSeconds) * time.Second,
		}, nil
	}
	return Decision{Allowed: true, Remaining: remaining}, nil
}

// onBackendFailure aplica la política de [Config.FailOpen].
//
// La decisión se toma AQUÍ y no en el middleware por una razón de diseño: quien conoce
// la política configurada es este paquete, y dejar que el borde interprete un error de
// Redis repartiría la misma decisión de seguridad por cada sitio que consulte el
// límite.
func (r *RedisLimiter) onBackendFailure(cause error) (Decision, error) {
	if r.cfg.FailOpen {
		// Se deja pasar, pero NO en silencio: `Remaining` a cero hace visible en las
		// cabeceras que el límite no se está aplicando de verdad.
		return Decision{Allowed: true, Remaining: 0}, nil
	}
	return Decision{}, fmt.Errorf("%w: %w", ErrBackendUnavailable, cause)
}

// Comprobación en tiempo de compilación del implementador.
var _ Limiter = (*RedisLimiter)(nil)
