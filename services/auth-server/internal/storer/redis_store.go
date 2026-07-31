package storer

import (
	"context"
	"errors"
	"fmt"
	"strings"
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
//
// AVISO DE DESPLIEGUE: [RedisStore.RotateRefreshToken] usa un script Lua que
// construye nombres de clave a partir de los miembros de un conjunto, así que NO es
// compatible con Redis Cluster —un script solo puede tocar claves del mismo slot—.
// El despliegue actual es una instancia única (`dev/docker-compose.yaml` y
// `deploy/`), que es lo adecuado para un almacén sin fuente de verdad. Si algún día
// se pasa a cluster, la familia hay que reindexarla con un hash tag por usuario.
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
	// familyPrefix indexa los refresh tokens vivos de un usuario. Existe solo para
	// poder invalidarlos TODOS de golpe al detectar una reutilización.
	familyPrefix = "refresh-family:"
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

// ErrTokenReuse señala que se presentó un refresh token ya rotado.
//
// Es un error propio y no un [ErrNotFound] porque exige una reacción distinta: un
// token que no existe puede ser simplemente uno caducado, mientras que uno YA ROTADO
// solo puede llegar de quien guardó una copia. Como el legítimo y el ladrón son
// indistinguibles a partir de ahí, la única respuesta segura es invalidar la familia
// entera y obligar a los dos a autenticarse de nuevo.
var ErrTokenReuse = errors.New("storer: refresh token reutilizado; familia invalidada")

// SaveRefreshToken guarda el refresh token y lo apunta en la familia del usuario.
//
// Las dos escrituras van en un pipeline transaccional: si la clave se guardara sin
// entrar en la familia, una reutilización posterior no la invalidaría —quedaría un
// token vivo fuera del alcance del mecanismo que existe para cortarlos.
func (r *RedisStore) SaveRefreshToken(ctx context.Context, tokenID string, userID uuid.UUID, ttl time.Duration) error {
	if tokenID == "" || ttl <= 0 {
		return wrap("guardar refresh token", ErrConflict)
	}

	familyKey := key(familyPrefix, userID.String())
	_, err := r.client.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.Set(ctx, key(refreshPrefix, tokenID), userID.String(), ttl)
		pipe.SAdd(ctx, familyKey, tokenID)
		// El índice de familia caduca con el token más largo que contiene. Sin TTL
		// sería la única clave inmortal de este almacén y crecería sin límite con cada
		// sesión histórica del usuario.
		pipe.Expire(ctx, familyKey, ttl)
		return nil
	})
	if err != nil {
		return wrap("guardar refresh token", err)
	}
	return nil
}

// usedMarker prefija el valor de un refresh token YA ROTADO.
//
// La rotación no BORRA el token viejo: lo marca. Esa es la diferencia entre poder
// detectar una reutilización y no poder. Si se borrara, presentar un token robado
// sería indistinguible de presentar uno caducado —«no existe» en los dos casos—, y
// toda la detección de robo de D-05 quedaría sin forma de dispararse.
//
// La marca conserva el TTL original, así que la ventana de detección es exactamente
// la vida que le quedaba al token. Pasado ese plazo caduca sola.
const usedMarker = "used:"

// Códigos de retorno del script de rotación. Se nombran porque un `-1` suelto en el
// `switch` no dice nada al leerlo.
const (
	rotateNotFound   int64 = 0
	rotateOK         int64 = 1
	rotateWrongOwner int64 = -1
	rotateReuse      int64 = -2
)

// rotateScript rota el refresh token de forma ATÓMICA.
//
// Va en un script Lua y no en un `MULTI/EXEC` porque hay que LEER el propietario y
// decidir en función de lo leído; `MULTI` encola comandos sin ver sus resultados, así
// que la decisión tendría que tomarse fuera y quedaría una ventana entre la lectura y
// la escritura — justo la ventana en la que dos renovaciones simultáneas del mismo
// token obtienen las dos un par nuevo, y la rotación deja de garantizar nada.
//
// KEYS[1] refresh:{old} · KEYS[2] refresh:{new} · KEYS[3] refresh-family:{userID}
// ARGV[1] userID · ARGV[2] ttl(s) · ARGV[3] newTokenID · ARGV[4] oldTokenID ·
// ARGV[5] el prefijo `used:`
var rotateScript = redis.NewScript(`
local owner = redis.call('GET', KEYS[1])
if not owner then
  return 0
end
if string.sub(owner, 1, string.len(ARGV[5])) == ARGV[5] then
  -- Ya rotado: es una reutilización. NO se rota nada; la invalidación de la familia
  -- la decide la capa de aplicación, que es quien sabe si el caso amerita cortarla.
  return -2
end
if owner ~= ARGV[1] then
  -- El token existe pero pertenece a otro usuario: no se toca. Invalidar aquí
  -- permitiría cerrarle la sesión a cualquiera adivinando identificadores.
  return -1
end
local remaining = redis.call('TTL', KEYS[1])
if remaining < 1 then remaining = 1 end
redis.call('SET', KEYS[1], ARGV[5] .. ARGV[1], 'EX', remaining)
redis.call('SREM', KEYS[3], ARGV[4])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
redis.call('SADD', KEYS[3], ARGV[3])
redis.call('EXPIRE', KEYS[3], ARGV[2])
return 1
`)

// RotateRefreshToken invalida el token presentado y guarda el nuevo atómicamente.
//
// La rotación es obligatoria (D-05): sin ella, un refresh token filtrado es una
// sesión perpetua que nadie puede cerrar.
func (r *RedisStore) RotateRefreshToken(
	ctx context.Context,
	oldTokenID, newTokenID string,
	userID uuid.UUID,
	ttl time.Duration,
) error {
	if oldTokenID == "" || newTokenID == "" || ttl <= 0 {
		return wrap("rotar refresh token", ErrConflict)
	}

	res, err := rotateScript.Run(ctx,
		r.client,
		[]string{
			key(refreshPrefix, oldTokenID),
			key(refreshPrefix, newTokenID),
			key(familyPrefix, userID.String()),
		},
		userID.String(),
		int64(ttl.Seconds()),
		newTokenID,
		oldTokenID,
		usedMarker,
	).Int64()
	if err != nil {
		return wrap("rotar refresh token", err)
	}

	switch res {
	case rotateOK:
		return nil
	case rotateNotFound:
		return wrap("rotar refresh token", ErrNotFound)
	case rotateReuse:
		return wrap("rotar refresh token", ErrTokenReuse)
	case rotateWrongOwner:
		return wrap("rotar refresh token", ErrConflict)
	default:
		return wrap("rotar refresh token", fmt.Errorf("código de script inesperado: %d", res))
	}
}

// invalidateFamilyScript borra todos los refresh tokens vivos de un usuario.
//
// KEYS[1] refresh-family:{userID} · ARGV[1] el prefijo `refresh:`.
//
// Ese ARGV[1] es lo que rompe la compatibilidad con Redis Cluster: las claves que
// borra el bucle no están declaradas en KEYS, así que el cluster no puede comprobar
// que caen en el mismo slot. Ver el aviso de despliegue de [RedisStore].
var invalidateFamilyScript = redis.NewScript(`
local members = redis.call('SMEMBERS', KEYS[1])
for i = 1, #members do
  redis.call('DEL', ARGV[1] .. members[i])
end
redis.call('DEL', KEYS[1])
return #members
`)

// InvalidateFamily borra todos los refresh tokens vivos del usuario.
//
// Borra —y no marca como usados— a propósito: la familia se corta porque ya hubo un
// robo confirmado, así que no queda nada que detectar en esos tokens. Marcarlos solo
// alargaría la vida de unas claves que nadie va a consultar.
func (r *RedisStore) InvalidateFamily(ctx context.Context, userID uuid.UUID) error {
	if err := invalidateFamilyScript.Run(ctx, r.client,
		[]string{key(familyPrefix, userID.String())},
		refreshPrefix,
	).Err(); err != nil {
		return wrap("invalidar familia de refresh tokens", err)
	}
	return nil
}

// DeleteRefreshToken revoca el refresh token (logout, FR-004).
//
// Borrar una clave inexistente NO es un error: el logout tiene que ser idempotente.
// Un segundo clic en «cerrar sesión», o un reintento de red, no puede acabar en un
// mensaje de fallo cuando el efecto buscado —que el token no valga— ya se cumplió.
//
// La entrada de la familia se limpia también; si no, un `SMEMBERS` posterior
// arrastraría tokens ya borrados y el barrido por reutilización trabajaría de más.
func (r *RedisStore) DeleteRefreshToken(ctx context.Context, tokenID string) error {
	if tokenID == "" {
		return wrap("revocar refresh token", ErrConflict)
	}

	refreshKey := key(refreshPrefix, tokenID)

	// Se lee el propietario ANTES de borrar para saber de qué familia quitarlo. Si el
	// token ya no está, no hay nada que limpiar.
	owner, err := r.client.Get(ctx, refreshKey).Result()
	if errors.Is(err, redis.Nil) {
		return nil
	}
	if err != nil {
		return wrap("revocar refresh token", err)
	}

	_, err = r.client.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.Del(ctx, refreshKey)
		pipe.SRem(ctx, key(familyPrefix, owner), tokenID)
		return nil
	})
	if err != nil {
		return wrap("revocar refresh token", err)
	}
	return nil
}

// LookupRefreshToken devuelve el usuario dueño del token.
//
// Ver el contrato de [TokenStore.LookupRefreshToken] para los tres resultados. El
// caso `ErrTokenReuse` devuelve el usuario JUNTO con el error, y esa combinación
// —poco habitual— es deliberada: sin el usuario, quien llama no podría cortar la
// familia, que es la única reacción segura a una reutilización.
func (r *RedisStore) LookupRefreshToken(ctx context.Context, tokenID string) (uuid.UUID, error) {
	if tokenID == "" {
		return uuid.Nil, wrap("consultar refresh token", ErrNotFound)
	}

	raw, err := r.client.Get(ctx, key(refreshPrefix, tokenID)).Result()
	if errors.Is(err, redis.Nil) {
		// `redis.Nil` se traduce al centinela de esta capa para que quien llame no
		// tenga que importar el driver: un `errors.Is(err, redis.Nil)` en `server`
		// acoplaría la capa de aplicación a Redis (Principio IX).
		return uuid.Nil, wrap("consultar refresh token", ErrNotFound)
	}
	if err != nil {
		return uuid.Nil, wrap("consultar refresh token", err)
	}

	reused := strings.HasPrefix(raw, usedMarker)
	userID, parseErr := uuid.Parse(strings.TrimPrefix(raw, usedMarker))
	if parseErr != nil {
		// El valor guardado no es un UUID: la clave está corrupta o la escribió otra
		// cosa. NO es «no encontrado», y confundirlos escondería el problema real.
		return uuid.Nil, wrap("consultar refresh token", fmt.Errorf("propietario ilegible: %w", parseErr))
	}
	if reused {
		return userID, wrap("consultar refresh token", ErrTokenReuse)
	}
	return userID, nil
}
