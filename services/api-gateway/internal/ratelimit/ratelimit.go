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

// ErrNotImplemented marca lo que llega con T057.
var ErrNotImplemented = errors.New("ratelimit: no implementado")

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

// Allow incrementa el contador de la ventana y decide.
//
// T057 lo implementa con `INCR` + `EXPIRE` en una sola ida y vuelta (pipeline o script
// Lua). Los dos comandos DEBEN ir juntos: si el proceso muere entre el `INCR` y el
// `EXPIRE`, la clave queda sin TTL y el cliente afectado se queda bloqueado para
// siempre —el contador nunca vuelve a cero.
//
// La ventana fija es deliberada frente a una deslizante: permite hasta el doble del
// límite en el cruce de dos ventanas, y a cambio cuesta un contador por clave en lugar
// de un sorted set con una entrada por petición. Para proteger de abuso, la
// aproximación sobra; si hiciera falta precisión, la decisión habría que revisarla.
func (r *RedisLimiter) Allow(ctx context.Context, key string) (Decision, error) {
	if key == "" {
		return Decision{}, fmt.Errorf("%w: clave vacía", ErrNotImplemented)
	}
	_ = keyPrefix + key
	_ = r.client
	_ = r.cfg
	return Decision{}, ErrNotImplemented
}

// Comprobación en tiempo de compilación del implementador.
var _ Limiter = (*RedisLimiter)(nil)
