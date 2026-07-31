package token

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
)

// Clave de prueba de 32 bytes. NO es un secreto real: solo existe dentro del test.
const testKey = "clave-de-prueba-de-32-bytes-1234"

const testUserID = "1f2e3d4c-5b6a-4798-8899-aabbccddeeff"

func newTestMaker(t *testing.T) *JWTMaker {
	t.Helper()
	m, err := NewJWTMaker(testKey)
	require.NoError(t, err)
	return m
}

func TestNewJWTMakerRejectsShortKey(t *testing.T) {
	t.Parallel()

	_, err := NewJWTMaker("demasiado-corta")
	require.ErrorIs(t, err, ErrKeyTooShort)
	// El mensaje debe llevar la longitud pero NUNCA la clave.
	require.NotContains(t, err.Error(), "demasiado-corta")
}

func TestIssueAndParseRoundTrip(t *testing.T) {
	t.Parallel()

	m := newTestMaker(t)
	roles := []string{"usuario_final", "editor"}
	scopes := []string{"catalog:read"}

	issued, err := m.Issue(testUserID, roles, scopes)
	require.NoError(t, err)
	require.NotEmpty(t, issued.Raw)
	require.NotEmpty(t, issued.JTI)
	require.WithinDuration(t, time.Now().UTC().Add(AccessTokenTTL), issued.ExpiresAt, time.Minute)

	claims, err := m.Parse(issued.Raw)
	require.NoError(t, err)
	require.Equal(t, testUserID, claims.UserID)
	require.Equal(t, issued.JTI, claims.JTI)
	require.Equal(t, roles, claims.Roles)
	require.Equal(t, scopes, claims.Scopes)
	require.Equal(t, issued.ExpiresAt.Unix(), claims.ExpiresAt.Unix())
}

func TestIssueGeneratesUniqueJTI(t *testing.T) {
	t.Parallel()

	m := newTestMaker(t)
	first, err := m.Issue(testUserID, nil, nil)
	require.NoError(t, err)
	second, err := m.Issue(testUserID, nil, nil)
	require.NoError(t, err)

	// Dos tokens con el mismo `jti` se revocarían juntos: cerrar una sesión cerraría
	// también la otra.
	require.NotEqual(t, first.JTI, second.JTI)
}

func TestParseRejectsWrongKey(t *testing.T) {
	t.Parallel()

	issued, err := newTestMaker(t).Issue(testUserID, nil, nil)
	require.NoError(t, err)

	other, err := NewJWTMaker("otra-clave-distinta-de-32-bytes!")
	require.NoError(t, err)

	_, err = other.Parse(issued.Raw)
	require.ErrorIs(t, err, ErrInvalidToken)
}

// TestParseRejectsAlgNone es la comprobación que justifica `WithValidMethods`.
//
// Un token con `alg: none` no lleva firma: si la librería aceptara el algoritmo que
// declara el propio token, cualquiera podría fabricar uno con los roles que quisiera.
func TestParseRejectsAlgNone(t *testing.T) {
	t.Parallel()

	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   testUserID,
			Audience:  jwt.ClaimStrings{Audience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			ID:        "00000000-0000-4000-8000-000000000000",
		},
		Roles: []string{"coordinador_editorial"},
	}
	unsigned, err := jwt.NewWithClaims(jwt.SigningMethodNone, claims).
		SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	_, err = newTestMaker(t).Parse(unsigned)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestParseRejectsExpiredToken(t *testing.T) {
	t.Parallel()

	m := newTestMaker(t)
	raw := signWith(t, Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   testUserID,
			Audience:  jwt.ClaimStrings{Audience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
			ID:        "00000000-0000-4000-8000-000000000001",
		},
	})

	_, err := m.Parse(raw)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestParseRejectsWrongIssuerOrAudience(t *testing.T) {
	t.Parallel()

	m := newTestMaker(t)
	base := func() jwt.RegisteredClaims {
		return jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   testUserID,
			Audience:  jwt.ClaimStrings{Audience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			ID:        "00000000-0000-4000-8000-000000000002",
		}
	}

	t.Run("emisor ajeno", func(t *testing.T) {
		t.Parallel()
		rc := base()
		rc.Issuer = "otro-emisor"
		_, err := m.Parse(signWith(t, Claims{RegisteredClaims: rc}))
		require.ErrorIs(t, err, ErrInvalidToken)
	})

	t.Run("audiencia ajena", func(t *testing.T) {
		t.Parallel()
		rc := base()
		rc.Audience = jwt.ClaimStrings{"otra-audiencia"}
		_, err := m.Parse(signWith(t, Claims{RegisteredClaims: rc}))
		require.ErrorIs(t, err, ErrInvalidToken)
	})
}

// TestParseRejectsTokenWithoutJTI: un token sin `jti` no se puede revocar, así que
// aceptarlo dejaría una sesión que nadie puede cerrar (FR-004).
func TestParseRejectsTokenWithoutJTI(t *testing.T) {
	t.Parallel()

	raw := signWith(t, Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   testUserID,
			Audience:  jwt.ClaimStrings{Audience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})

	_, err := newTestMaker(t).Parse(raw)
	require.ErrorIs(t, err, ErrInvalidToken)
}

// TestParseRejectsTokenWithoutExpiration: sin `exp`, la librería consideraría el
// token válido para siempre — un token eterno que la blacklist tampoco puede
// caducar.
func TestParseRejectsTokenWithoutExpiration(t *testing.T) {
	t.Parallel()

	raw := signWith(t, Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:   Issuer,
			Subject:  testUserID,
			Audience: jwt.ClaimStrings{Audience},
			ID:       "00000000-0000-4000-8000-000000000003",
		},
	})

	_, err := newTestMaker(t).Parse(raw)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestParseRejectsGarbage(t *testing.T) {
	t.Parallel()

	for _, raw := range []string{"", "no-es-un-jwt", "a.b.c"} {
		_, err := newTestMaker(t).Parse(raw)
		require.ErrorIs(t, err, ErrInvalidToken, "entrada %q", raw)
	}
}

// signWith firma unos claims con la clave de prueba, saltándose `Issue`.
//
// Existe para poder construir tokens que `Issue` nunca produciría (sin `jti`, ya
// expirados, con otro emisor) y comprobar que `Parse` los rechaza. Sin este atajo,
// esos casos no serían comprobables.
func signWith(t *testing.T, claims Claims) string {
	t.Helper()
	raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testKey))
	require.NoError(t, err)
	return raw
}
