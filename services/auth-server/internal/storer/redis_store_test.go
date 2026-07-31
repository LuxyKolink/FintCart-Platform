package storer

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

// Pruebas contra `miniredis`, un Redis en memoria que habla el mismo protocolo e
// interpreta Lua. Se usa en lugar de un doble del cliente por una razón concreta:
// lo que hay que comprobar aquí es el COMPORTAMIENTO del script de rotación —qué
// claves quedan y cuáles desaparecen—, y un doble solo confirmaría que se llamó a
// `Eval` con los argumentos esperados, que es exactamente lo que no importa.
//
// §Calidad: sin base de datos viva. `miniredis` corre en el proceso del test.

const testTTL = time.Hour

func newTestStore(t *testing.T) (*RedisStore, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return NewRedisStore(client), mr
}

// ── blacklist ───────────────────────────────────────────────────────────────

func TestBlacklistJTIRoundTrip(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, mr := newTestStore(t)

	blacklisted, err := s.IsBlacklisted(ctx, "jti-1")
	require.NoError(t, err)
	require.False(t, blacklisted)

	require.NoError(t, s.BlacklistJTI(ctx, "jti-1", testTTL))

	blacklisted, err = s.IsBlacklisted(ctx, "jti-1")
	require.NoError(t, err)
	require.True(t, blacklisted)

	// El TTL debe ser la vida residual del token, no eterno: si no caducara, Redis
	// acumularía una entrada por cada sesión cerrada en la historia del sistema.
	require.Equal(t, testTTL, mr.TTL(blacklistPrefix+"jti-1"))
}

func TestBlacklistJTIRejectsNonPositiveTTL(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newTestStore(t)

	// Redis trata `EX 0` como error y un TTL negativo como «borrar»: sin este
	// control, revocar un token ya expirado no revocaría nada y no avisaría.
	require.ErrorIs(t, s.BlacklistJTI(ctx, "jti-1", 0), ErrConflict)
	require.ErrorIs(t, s.BlacklistJTI(ctx, "jti-1", -time.Second), ErrConflict)
	require.ErrorIs(t, s.BlacklistJTI(ctx, "", testTTL), ErrConflict)
}

func TestBlacklistExpires(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, mr := newTestStore(t)

	require.NoError(t, s.BlacklistJTI(ctx, "jti-1", time.Minute))
	mr.FastForward(2 * time.Minute)

	blacklisted, err := s.IsBlacklisted(ctx, "jti-1")
	require.NoError(t, err)
	require.False(t, blacklisted)
}

// ── refresh tokens ──────────────────────────────────────────────────────────

func TestSaveAndLookupRefreshToken(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newTestStore(t)
	userID := uuid.New()

	require.NoError(t, s.SaveRefreshToken(ctx, "tok-1", userID, testTTL))

	got, err := s.LookupRefreshToken(ctx, "tok-1")
	require.NoError(t, err)
	require.Equal(t, userID, got)
}

func TestLookupRefreshTokenNotFound(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newTestStore(t)

	// `redis.Nil` se traduce al centinela de esta capa: `server` no debe tener que
	// importar el driver para saber que un token no existe (Principio IX).
	_, err := s.LookupRefreshToken(ctx, "inexistente")
	require.ErrorIs(t, err, ErrNotFound)
}

func TestRotateRefreshTokenHappyPath(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newTestStore(t)
	userID := uuid.New()

	require.NoError(t, s.SaveRefreshToken(ctx, "tok-1", userID, testTTL))
	require.NoError(t, s.RotateRefreshToken(ctx, "tok-1", "tok-2", userID, testTTL))

	// El anterior queda INVÁLIDO en el mismo acto (D-05). Sin esto, un refresh token
	// filtrado sería una sesión perpetua que nadie puede cerrar.
	//
	// Y queda marcado como USADO, no borrado: la consulta devuelve `ErrTokenReuse`
	// junto con el propietario. Borrarlo lo haría indistinguible de uno caducado y la
	// detección de robo no tendría de dónde dispararse.
	owner, err := s.LookupRefreshToken(ctx, "tok-1")
	require.ErrorIs(t, err, ErrTokenReuse)
	require.Equal(t, userID, owner)

	got, err := s.LookupRefreshToken(ctx, "tok-2")
	require.NoError(t, err)
	require.Equal(t, userID, got)
}

// TestRotateDetectsReuse es la mitad de almacenamiento de D-05.
//
// Presentar un refresh token YA rotado solo puede venir de quien guardó una copia.
// Esta capa lo DETECTA y lo informa; cortar la familia es una decisión de la capa de
// aplicación (`server.RefreshToken`), no de aquí — el almacén no sabe si el caso
// amerita cerrar todas las sesiones del usuario.
func TestRotateDetectsReuse(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newTestStore(t)
	userID := uuid.New()

	require.NoError(t, s.SaveRefreshToken(ctx, "tok-1", userID, testTTL))
	require.NoError(t, s.RotateRefreshToken(ctx, "tok-1", "tok-2", userID, testTTL))

	// El ladrón presenta el token viejo, que ya fue rotado.
	err := s.RotateRefreshToken(ctx, "tok-1", "tok-3", userID, testTTL)
	require.ErrorIs(t, err, ErrTokenReuse)

	// No se ha rotado nada: `tok-2` sigue vivo y `tok-3` no llegó a existir.
	got, err := s.LookupRefreshToken(ctx, "tok-2")
	require.NoError(t, err)
	require.Equal(t, userID, got)
	_, err = s.LookupRefreshToken(ctx, "tok-3")
	require.ErrorIs(t, err, ErrNotFound)
}

// TestRotateDistinguishesExpiredFromReused: caducado da `ErrNotFound` y reutilizado
// da `ErrTokenReuse`. Colapsarlos haría imposible reaccionar solo al robo.
func TestRotateDistinguishesExpiredFromReused(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newTestStore(t)
	userID := uuid.New()

	err := s.RotateRefreshToken(ctx, "nunca-existio", "tok-2", userID, testTTL)
	require.ErrorIs(t, err, ErrNotFound)
	require.NotErrorIs(t, err, ErrTokenReuse)
}

// TestInvalidateFamilyKillsEveryLiveToken es la reacción al robo detectado: el
// usuario legítimo y el ladrón son indistinguibles, así que caen todas las sesiones.
func TestInvalidateFamilyKillsEveryLiveToken(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newTestStore(t)
	userID := uuid.New()

	require.NoError(t, s.SaveRefreshToken(ctx, "tok-1", userID, testTTL))
	require.NoError(t, s.SaveRefreshToken(ctx, "tok-2", userID, testTTL))
	require.NoError(t, s.InvalidateFamily(ctx, userID))

	for _, id := range []string{"tok-1", "tok-2"} {
		_, err := s.LookupRefreshToken(ctx, id)
		require.ErrorIs(t, err, ErrNotFound, "token %s", id)
	}
}

// TestInvalidateFamilyDoesNotTouchOtherUsers: cortar la familia de uno no puede
// cerrarle la sesión a nadie más.
func TestInvalidateFamilyDoesNotTouchOtherUsers(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newTestStore(t)
	victim, bystander := uuid.New(), uuid.New()

	require.NoError(t, s.SaveRefreshToken(ctx, "tok-victima", victim, testTTL))
	require.NoError(t, s.SaveRefreshToken(ctx, "tok-ajeno", bystander, testTTL))
	require.NoError(t, s.InvalidateFamily(ctx, victim))

	got, err := s.LookupRefreshToken(ctx, "tok-ajeno")
	require.NoError(t, err)
	require.Equal(t, bystander, got)
}

func TestRotateRejectsTokenOfAnotherUser(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newTestStore(t)
	owner := uuid.New()
	attacker := uuid.New()

	require.NoError(t, s.SaveRefreshToken(ctx, "tok-1", owner, testTTL))

	err := s.RotateRefreshToken(ctx, "tok-1", "tok-2", attacker, testTTL)
	require.ErrorIs(t, err, ErrConflict)

	// El token del dueño NO se toca: invalidarlo aquí permitiría cerrarle la sesión a
	// cualquiera adivinando identificadores de token.
	got, err := s.LookupRefreshToken(ctx, "tok-1")
	require.NoError(t, err)
	require.Equal(t, owner, got)
}

func TestDeleteRefreshTokenIsIdempotent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newTestStore(t)
	userID := uuid.New()

	require.NoError(t, s.SaveRefreshToken(ctx, "tok-1", userID, testTTL))
	require.NoError(t, s.DeleteRefreshToken(ctx, "tok-1"))

	_, err := s.LookupRefreshToken(ctx, "tok-1")
	require.ErrorIs(t, err, ErrNotFound)

	// Un segundo logout —o un reintento de red— no puede acabar en error: el efecto
	// buscado ya se cumplió.
	require.NoError(t, s.DeleteRefreshToken(ctx, "tok-1"))
}

func TestDeleteRefreshTokenCleansTheFamilyIndex(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, mr := newTestStore(t)
	userID := uuid.New()

	require.NoError(t, s.SaveRefreshToken(ctx, "tok-1", userID, testTTL))
	require.NoError(t, s.SaveRefreshToken(ctx, "tok-2", userID, testTTL))
	require.NoError(t, s.DeleteRefreshToken(ctx, "tok-1"))

	members, err := mr.SMembers(familyPrefix + userID.String())
	require.NoError(t, err)
	require.Equal(t, []string{"tok-2"}, members)
}

func TestSaveRefreshTokenExpiresTheFamilyIndex(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, mr := newTestStore(t)
	userID := uuid.New()

	require.NoError(t, s.SaveRefreshToken(ctx, "tok-1", userID, testTTL))

	// Sin TTL, el índice de familia sería la única clave inmortal del almacén y
	// crecería con cada sesión histórica del usuario.
	require.Equal(t, testTTL, mr.TTL(familyPrefix+userID.String()))
}

func TestRefreshTokenGuards(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s, _ := newTestStore(t)
	userID := uuid.New()

	require.ErrorIs(t, s.SaveRefreshToken(ctx, "", userID, testTTL), ErrConflict)
	require.ErrorIs(t, s.SaveRefreshToken(ctx, "tok", userID, 0), ErrConflict)
	require.ErrorIs(t, s.RotateRefreshToken(ctx, "", "tok-2", userID, testTTL), ErrConflict)
	require.ErrorIs(t, s.RotateRefreshToken(ctx, "tok-1", "", userID, testTTL), ErrConflict)
	require.ErrorIs(t, s.DeleteRefreshToken(ctx, ""), ErrConflict)
	_, err := s.LookupRefreshToken(ctx, "")
	require.ErrorIs(t, err, ErrNotFound)
}
