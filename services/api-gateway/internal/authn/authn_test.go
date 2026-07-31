package authn

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

// Pruebas del verificador de tokens del borde.
//
// Casi todas construyen tokens que el Servidor de Autenticación NUNCA emitiría —sin
// firma, con otro emisor, sin `exp`—, y esa es exactamente la razón de que existan:
// lo que hay que comprobar de un verificador no es que acepte lo bueno, sino que
// rechace lo que un atacante fabricaría. Un verificador que solo se prueba con tokens
// legítimos pasa igual de bien estando roto.
//
// §Calidad: sin dependencias vivas. Las claves se generan en el propio test.

const testSecret = "clave-hmac-de-prueba-con-mas-de-32-bytes"

// validClaims construye los claims de un token que debería pasar.
func validClaims() *gatewayClaims {
	return &gatewayClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "11111111-1111-4111-8111-111111111111",
			ID:        "jti-de-prueba",
			Issuer:    expectedIssuer,
			Audience:  jwt.ClaimStrings{expectedAudience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
		Roles: []string{"usuario_final"},
	}
}

// signHS256 firma unos claims con el secreto de prueba.
func signHS256(t *testing.T, claims jwt.Claims) string {
	t.Helper()
	raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	require.NoError(t, err)
	return raw
}

func newHS256Verifier(t *testing.T) *JWTVerifier {
	t.Helper()
	v, err := NewJWTVerifier(AlgHS256, testSecret)
	require.NoError(t, err)
	return v
}

// ── construcción ────────────────────────────────────────────────────────────

func TestNewJWTVerifierRejectsEmptyKey(t *testing.T) {
	t.Parallel()
	_, err := NewJWTVerifier(AlgHS256, "")
	require.ErrorIs(t, err, ErrEmptyKey)
}

// TestNewJWTVerifierRejectsShortHMACKey: el mínimo debe exigirlo también el Gateway.
// Si solo lo comprobara Auth, un despliegue con `JWT_SIGNING_KEY=secreto` arrancaría
// el borde sin protestar y la firma sería forzable por fuerza bruta.
func TestNewJWTVerifierRejectsShortHMACKey(t *testing.T) {
	t.Parallel()
	_, err := NewJWTVerifier(AlgHS256, "demasiado-corta")
	require.ErrorIs(t, err, ErrEmptyKey)
}

// TestNewJWTVerifierRejectsMalformedPEM: un PEM ilegible debe impedir el ARRANQUE.
// Descubrirlo en la primera petición produciría un borde que acepta tráfico y devuelve
// 401 a todo el mundo, un síntoma que no apunta a la variable de entorno culpable.
func TestNewJWTVerifierRejectsMalformedPEM(t *testing.T) {
	t.Parallel()
	_, err := NewJWTVerifier(AlgRS256, "esto no es un PEM")
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrEmptyKey)
}

func TestNewJWTVerifierRejectsUnknownAlgorithm(t *testing.T) {
	t.Parallel()
	_, err := NewJWTVerifier(Algorithm("HS512"), testSecret)
	require.ErrorIs(t, err, ErrUnsupportedAlgorithm)
}

// ── verificación ────────────────────────────────────────────────────────────

func TestVerifyAcceptsWellFormedToken(t *testing.T) {
	t.Parallel()
	v := newHS256Verifier(t)

	claims, err := v.Verify(signHS256(t, validClaims()))
	require.NoError(t, err)
	require.Equal(t, "11111111-1111-4111-8111-111111111111", claims.UserID)
	require.Equal(t, "jti-de-prueba", claims.JTI)
	require.Equal(t, []string{"usuario_final"}, claims.Roles)
}

// TestVerifyRejectsAlgNone es la prueba más importante de este archivo.
//
// `alg: none` produce un token SIN firma cuya carga útil escribe quien envía la
// petición: si se aceptara, cualquiera se declararía `coordinador_editorial`. Lo cierra
// `jwt.WithValidMethods`, que fija el algoritmo desde el despliegue en lugar de leerlo
// del propio token.
func TestVerifyRejectsAlgNone(t *testing.T) {
	t.Parallel()
	v := newHS256Verifier(t)

	forged := validClaims()
	forged.Roles = []string{"coordinador_editorial"}
	raw, err := jwt.NewWithClaims(jwt.SigningMethodNone, forged).
		SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	_, err = v.Verify(raw)
	require.ErrorIs(t, err, ErrInvalidToken)
}

// TestVerifyRejectsAlgorithmDowngrade: un token HS256 no puede pasar por un verificador
// configurado en RS256. Es la otra mitad de la confusión de algoritmo: sin
// `WithValidMethods`, la librería usaría la clave pública RSA como secreto HMAC, y una
// clave PÚBLICA la conoce cualquiera.
func TestVerifyRejectsAlgorithmDowngrade(t *testing.T) {
	t.Parallel()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	require.NoError(t, err)
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})

	v, err := NewJWTVerifier(AlgRS256, string(pubPEM))
	require.NoError(t, err)

	// Token legítimo bajo RS256: pasa.
	rs, err := jwt.NewWithClaims(jwt.SigningMethodRS256, validClaims()).SignedString(key)
	require.NoError(t, err)
	claims, err := v.Verify(rs)
	require.NoError(t, err)
	require.Equal(t, "jti-de-prueba", claims.JTI)

	// El mismo contenido firmado con HMAC usando la clave pública como secreto: NO.
	forged, err := jwt.NewWithClaims(jwt.SigningMethodHS256, validClaims()).SignedString(pubPEM)
	require.NoError(t, err)
	_, err = v.Verify(forged)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestVerifyRejectsWrongSignature(t *testing.T) {
	t.Parallel()
	v := newHS256Verifier(t)

	raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, validClaims()).
		SignedString([]byte("otra-clave-igual-de-larga-que-la-buena"))
	require.NoError(t, err)

	_, err = v.Verify(raw)
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestVerifyRejectsExpiredToken(t *testing.T) {
	t.Parallel()
	v := newHS256Verifier(t)

	claims := validClaims()
	claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Minute))

	_, err := v.Verify(signHS256(t, claims))
	require.ErrorIs(t, err, ErrInvalidToken)
}

// TestVerifyRejectsTokenWithoutExpiration: sin `WithExpirationRequired`, la librería
// trata la ausencia de `exp` como «no caduca», y un token filtrado sería una sesión
// perpetua imposible de dejar morir sola.
func TestVerifyRejectsTokenWithoutExpiration(t *testing.T) {
	t.Parallel()
	v := newHS256Verifier(t)

	claims := validClaims()
	claims.ExpiresAt = nil

	_, err := v.Verify(signHS256(t, claims))
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestVerifyRejectsWrongIssuerOrAudience(t *testing.T) {
	t.Parallel()
	v := newHS256Verifier(t)

	otherIssuer := validClaims()
	otherIssuer.Issuer = "otro-emisor"
	_, err := v.Verify(signHS256(t, otherIssuer))
	require.ErrorIs(t, err, ErrInvalidToken)

	// Un token perfectamente válido emitido para OTRA audiencia —por ejemplo un cliente
	// M2M— no puede abrir el borde de usuario final.
	otherAudience := validClaims()
	otherAudience.Audience = jwt.ClaimStrings{"otro-servicio"}
	_, err = v.Verify(signHS256(t, otherAudience))
	require.ErrorIs(t, err, ErrInvalidToken)
}

// TestVerifyRejectsMissingSubjectOrJTI cubre dos fallos silenciosos distintos:
// un `sub` vacío llegaría al dominio como «el usuario cuyo id es la cadena vacía», y
// un `jti` vacío haría la sesión IMPOSIBLE de revocar (FR-004).
func TestVerifyRejectsMissingSubjectOrJTI(t *testing.T) {
	t.Parallel()
	v := newHS256Verifier(t)

	noSub := validClaims()
	noSub.Subject = ""
	_, err := v.Verify(signHS256(t, noSub))
	require.ErrorIs(t, err, ErrInvalidToken)

	noJTI := validClaims()
	noJTI.ID = ""
	_, err = v.Verify(signHS256(t, noJTI))
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestVerifyRejectsGarbage(t *testing.T) {
	t.Parallel()
	v := newHS256Verifier(t)

	for _, raw := range []string{"", "no-es-un-jwt", "a.b.c", "Bearer algo"} {
		_, err := v.Verify(raw)
		require.ErrorIs(t, err, ErrInvalidToken, "entrada %q", raw)
	}
}

// ── blacklist ───────────────────────────────────────────────────────────────

func TestRedisBlacklistReadsWhatAuthWrites(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	b := NewRedisBlacklist(client)

	revoked, err := b.IsBlacklisted(ctx, "jti-1")
	require.NoError(t, err)
	require.False(t, revoked)

	// Se escribe con el MISMO formato de clave que `auth-server`. Es el acoplamiento
	// asumido a cambio de no pagar un salto gRPC por petición; si alguna vez divergen,
	// esta prueba es lo único que lo detectaría antes de que la revocación deje de
	// funcionar en silencio.
	require.NoError(t, mr.Set(blacklistKeyPrefix+"jti-1", "1"))

	revoked, err = b.IsBlacklisted(ctx, "jti-1")
	require.NoError(t, err)
	require.True(t, revoked)
}

// TestRedisBlacklistTreatsMissingJTIAsRevoked: un token sin `jti` no se puede revocar,
// así que aceptarlo dejaría una sesión que nadie puede cerrar.
func TestRedisBlacklistTreatsMissingJTIAsRevoked(t *testing.T) {
	t.Parallel()

	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = client.Close() })

	revoked, err := NewRedisBlacklist(client).IsBlacklisted(context.Background(), "")
	require.ErrorIs(t, err, ErrInvalidToken)
	require.True(t, revoked)
}
