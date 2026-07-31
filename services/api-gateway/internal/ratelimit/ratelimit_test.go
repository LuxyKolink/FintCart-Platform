package ratelimit

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

// Pruebas contra `miniredis`, que interpreta Lua de verdad. Un doble del cliente solo
// confirmaría que se llamó a `Eval` con ciertos argumentos, y lo que hay que comprobar
// aquí es el EFECTO del script: cuántas peticiones pasan, qué TTL queda en la clave y
// qué ocurre en el cruce de dos ventanas.
//
// §Calidad: sin Redis vivo. `miniredis` corre en el proceso del test.

func newTestLimiter(t *testing.T, cfg Config) (*RedisLimiter, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return NewRedisLimiter(client, cfg), mr
}

func TestAllowsUpToTheLimitAndThenBlocks(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	l, _ := newTestLimiter(t, Config{Limit: 3, Window: time.Minute})

	for i := 1; i <= 3; i++ {
		d, err := l.Allow(ctx, "ip:1.2.3.4")
		require.NoError(t, err)
		require.True(t, d.Allowed, "la petición %d debería pasar", i)
		require.Equal(t, int64(3-i), d.Remaining)
	}

	d, err := l.Allow(ctx, "ip:1.2.3.4")
	require.NoError(t, err)
	require.False(t, d.Allowed)
	require.Zero(t, d.Remaining)
	// `Retry-After` sin valor útil invita al cliente a reintentar de inmediato, que es
	// justo lo que el límite quiere evitar.
	require.Positive(t, d.RetryAfter)
}

func TestKeysAreIndependent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	l, _ := newTestLimiter(t, Config{Limit: 1, Window: time.Minute})

	first, err := l.Allow(ctx, "ip:1.1.1.1")
	require.NoError(t, err)
	require.True(t, first.Allowed)

	// Agotar la cuota de una IP no puede dejar sin servicio a otra: sería un ataque de
	// denegación trivial contra el resto de usuarios.
	other, err := l.Allow(ctx, "ip:2.2.2.2")
	require.NoError(t, err)
	require.True(t, other.Allowed)
}

// TestCounterAlwaysExpires es el invariante que justifica que esto sea un script Lua.
//
// Un contador sin TTL nunca vuelve a cero: el cliente afectado quedaría bloqueado para
// siempre por un fallo transitorio.
func TestCounterAlwaysExpires(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	l, mr := newTestLimiter(t, Config{Limit: 5, Window: 30 * time.Second})

	_, err := l.Allow(ctx, "ip:1.2.3.4")
	require.NoError(t, err)
	require.Equal(t, 30*time.Second, mr.TTL(keyPrefix+"ip:1.2.3.4"))
}

// TestWindowIsFixedNotSliding: el TTL se pone solo en el primer incremento. Renovarlo
// en cada petición haría que quien siguiera martilleando mantuviera su propio contador
// vivo indefinidamente y no recuperase cuota nunca.
func TestWindowIsFixedNotSliding(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	l, mr := newTestLimiter(t, Config{Limit: 10, Window: time.Minute})

	_, err := l.Allow(ctx, "ip:1.2.3.4")
	require.NoError(t, err)

	mr.FastForward(40 * time.Second)
	_, err = l.Allow(ctx, "ip:1.2.3.4")
	require.NoError(t, err)

	require.Equal(t, 20*time.Second, mr.TTL(keyPrefix+"ip:1.2.3.4"))
}

func TestQuotaRecoversAfterTheWindow(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	l, mr := newTestLimiter(t, Config{Limit: 1, Window: time.Minute})

	_, err := l.Allow(ctx, "ip:1.2.3.4")
	require.NoError(t, err)
	blocked, err := l.Allow(ctx, "ip:1.2.3.4")
	require.NoError(t, err)
	require.False(t, blocked.Allowed)

	mr.FastForward(2 * time.Minute)

	recovered, err := l.Allow(ctx, "ip:1.2.3.4")
	require.NoError(t, err)
	require.True(t, recovered.Allowed)
}

// TestBlockedRequestsStillCount: no incrementar tras superar el límite permitiría que
// un cliente que no deja de martillear recuperase cuota íntegra al expirar la ventana,
// eliminando el incentivo a parar.
func TestBlockedRequestsStillCount(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	l, mr := newTestLimiter(t, Config{Limit: 1, Window: time.Minute})

	for range 5 {
		_, err := l.Allow(ctx, "ip:1.2.3.4")
		require.NoError(t, err)
	}

	counter, err := mr.Get(keyPrefix + "ip:1.2.3.4")
	require.NoError(t, err)
	require.Equal(t, "5", counter)
}

// TestFailClosedByDefault: si Redis no responde, se RECHAZA. Dejar pasar dejaría la
// plataforma sin ninguna protección de tasa justo cuando ya está degradada, que es el
// momento en que más falta hace.
func TestFailClosedByDefault(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	l, mr := newTestLimiter(t, Config{Limit: 10, Window: time.Minute})
	mr.Close()

	_, err := l.Allow(ctx, "ip:1.2.3.4")
	require.ErrorIs(t, err, ErrBackendUnavailable)
}

// TestFailOpenIsOptIn: un operador puede preferir disponibilidad, pero tiene que
// pedirlo explícitamente.
func TestFailOpenIsOptIn(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	l, mr := newTestLimiter(t, Config{Limit: 10, Window: time.Minute, FailOpen: true})
	mr.Close()

	d, err := l.Allow(ctx, "ip:1.2.3.4")
	require.NoError(t, err)
	require.True(t, d.Allowed)
	// `Remaining` a cero hace visible en las cabeceras que el límite no se está
	// aplicando de verdad, en lugar de fingir que todo va bien.
	require.Zero(t, d.Remaining)
}

func TestRejectsEmptyKey(t *testing.T) {
	t.Parallel()
	l, _ := newTestLimiter(t, Config{Limit: 10, Window: time.Minute})

	// Una clave vacía haría que todo el tráfico sin identificar compartiera un mismo
	// contador y unas pocas peticiones anónimas agotaran la cuota de todas las demás.
	_, err := l.Allow(context.Background(), "")
	require.ErrorIs(t, err, ErrInvalidKey)
}

// TestSubSecondWindowStillExpires: Redis mide `EXPIRE` en segundos enteros y trata el 0
// como error, así que una ventana sub-segundo tiene que redondearse al mínimo
// representable en lugar de producir una clave inmortal.
func TestSubSecondWindowStillExpires(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	l, mr := newTestLimiter(t, Config{Limit: 1, Window: 100 * time.Millisecond})

	_, err := l.Allow(ctx, "ip:1.2.3.4")
	require.NoError(t, err)
	require.Equal(t, time.Second, mr.TTL(keyPrefix+"ip:1.2.3.4"))
}
