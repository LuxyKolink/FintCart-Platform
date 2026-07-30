package storer

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// RedisStore implementa [TokenStore]: blacklist de JWT y refresh tokens.
//
// Es UNO de los dos únicos usos de Redis permitidos en la plataforma
// (Principio IV; el otro es el rate limiting del Gateway). La restricción tiene un
// motivo concreto: Redis no es la fuente de verdad de nada. Si se cae y se pierde
// su contenido, el efecto debe ser acotado y aceptable —sesiones que hay que
// reiniciar—, nunca una credencial perdida. Por eso las credenciales están en
// PostgreSQL y aquí solo hay datos que caducan por sí solos.
type RedisStore struct {
	client redis.UniversalClient
}

// NewRedisStore construye el almacén sobre un cliente ya conectado.
func NewRedisStore(client redis.UniversalClient) *RedisStore {
	return &RedisStore{client: client}
}

// Prefijos de clave. Se centralizan aquí porque una clave mal escrita en un solo
// sitio no da error: simplemente escribe en un espacio de nombres que nadie lee,
// y el síntoma es «la revocación no surte efecto», que en un servicio de
// autenticación es un fallo de seguridad silencioso.
const (
	blacklistPrefix = "blacklist:"
	refreshPrefix   = "refresh:"
)

// key compone una clave con su prefijo.
func key(prefix, id string) string {
	return prefix + id
}

// ── blacklist de access tokens (FR-004) ─────────────────────────────────────

// BlacklistJTI registra el `jti` con TTL igual a la vida residual del token.
//
// El valor almacenado es irrelevante —lo que importa es que la clave exista—, así
// que se guarda el mínimo. Un TTL no positivo se rechaza en lugar de escribirse:
// Redis interpreta `EX 0` como error y un TTL negativo como «borrar», de modo que
// revocar un token ya expirado acabaría, sin este control, en una revocación que
// no revoca nada y no avisa.
func (r *RedisStore) BlacklistJTI(ctx context.Context, jti string, ttl time.Duration) error {
	if jti == "" || ttl <= 0 {
		return wrap("revocar jti", ErrConflict)
	}
	if err := r.client.Set(ctx, key(blacklistPrefix, jti), 1, ttl).Err(); err != nil {
		return wrap("revocar jti", err)
	}
	return nil
}

// IsBlacklisted lo consulta el Gateway en cada petición autenticada.
//
// Si Redis no responde, esta función NO devuelve `false, nil`. «No sé si está
// revocado» se propaga como error para que el borde decida —y la decisión correcta
// en un servicio financiero es rechazar—, porque tratar la duda como «no revocado»
// convertiría una caída de Redis en la reactivación de todos los tokens revocados.
func (r *RedisStore) IsBlacklisted(ctx context.Context, jti string) (bool, error) {
	n, err := r.client.Exists(ctx, key(blacklistPrefix, jti)).Result()
	if err != nil {
		return false, wrap("consultar blacklist", err)
	}
	return n > 0, nil
}

// ── refresh tokens con rotación (D-05) ──────────────────────────────────────

func (r *RedisStore) SaveRefreshToken(_ context.Context, tokenID string, userID uuid.UUID, ttl time.Duration) error {
	_, _, _ = tokenID, userID, ttl
	return ErrNotImplemented
}

// RotateRefreshToken invalida el token presentado y guarda el nuevo atómicamente.
//
// T049 lo implementa con una transacción `MULTI/EXEC` (o un script Lua), no con
// dos comandos sueltos. Además debe detectar la REUTILIZACIÓN: si llega un
// refresh token que ya fue rotado, lo correcto no es simplemente rechazarlo, sino
// invalidar toda la familia de tokens de ese usuario — la reutilización es la señal
// de que un refresh token fue robado, y el ladrón y la víctima son
// indistinguibles a partir de ese punto.
func (r *RedisStore) RotateRefreshToken(_ context.Context, oldTokenID, newTokenID string, userID uuid.UUID, ttl time.Duration) error {
	_, _ = oldTokenID, newTokenID
	_, _ = userID, ttl
	return ErrNotImplemented
}

func (r *RedisStore) DeleteRefreshToken(_ context.Context, tokenID string) error {
	_ = key(refreshPrefix, tokenID)
	return ErrNotImplemented
}

func (r *RedisStore) LookupRefreshToken(_ context.Context, tokenID string) (uuid.UUID, error) {
	_ = key(refreshPrefix, tokenID)
	return uuid.Nil, ErrNotImplemented
}
