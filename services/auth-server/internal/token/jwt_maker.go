package token

import (
	"errors"
	"fmt"

	"github.com/fintcart/platform/services/auth-server/internal/server"
)

// ErrNotImplemented marca lo que llega con T048.
//
// En un emisor de tokens, el stub tiene que gritar. `Issue` devolviendo el cero
// entregaría un token vacío que el Gateway rechazaría con 401, y el síntoma sería
// «el login no funciona» sin señalar a este componente; `Parse` devolviendo unos
// claims vacíos y `nil` sería directamente un fallo de seguridad —cualquier cadena
// pasaría por un token válido de un usuario sin roles.
var ErrNotImplemented = errors.New("token: no implementado")

// ErrInvalidToken se devuelve cuando la firma, el emisor, la audiencia o la
// expiración no cuadran.
//
// Es UN solo error para los cuatro casos, igual que `server.ErrUnauthenticated` lo
// es para el login: distinguir «firma inválida» de «expirado» le dice a quien
// prueba tokens al azar cuál de sus intentos se acercó más.
var ErrInvalidToken = errors.New("token: token inválido")

// JWTMaker implementa [server.TokenMaker] con HMAC-SHA256.
//
// La clave es simétrica y la comparte con quien deba VERIFICAR. Eso es aceptable
// mientras el único verificador sea el propio Auth, y deja de serlo en cuanto el API
// Gateway verifica por su cuenta: con HS256, quien puede verificar puede también
// FIRMAR, así que un Gateway comprometido podría emitir tokens de administrador.
//
// PENDIENTE (T048/T056): migrar a un par asimétrico (RS256/ES256) y publicar solo la
// clave pública al Gateway. La firma de esta estructura ya lo contempla —el campo se
// llama `signingKey` y no `secret`— pero el cambio afecta a `dev/docker-compose.yaml`
// (que hoy pasa el mismo `JWT_SIGNING_KEY` a los dos) y a la configuración de
// despliegue, así que se decide en su tarea y no aquí.
type JWTMaker struct {
	signingKey []byte
}

// ErrKeyTooShort rechaza claves que no aportan la entropía del algoritmo.
var ErrKeyTooShort = errors.New("token: la clave de firma es demasiado corta")

// minSigningKeyBytes son los 32 bytes que exige HS256.
//
// Una clave más corta que la salida de SHA-256 no debilita el hash pero sí acota el
// espacio de búsqueda de un ataque offline sobre un token capturado, y es un error
// de configuración que se detecta gratis al arrancar.
const minSigningKeyBytes = 32

// NewJWTMaker valida la clave y construye el emisor.
//
// Se valida AQUÍ, en el arranque, y no en la primera emisión: un despliegue con una
// clave de ocho caracteres debe negarse a arrancar, no atender tráfico y firmar
// tokens débiles hasta que alguien lo audite.
func NewJWTMaker(signingKey string) (*JWTMaker, error) {
	if len(signingKey) < minSigningKeyBytes {
		return nil, fmt.Errorf("%w: %d bytes, se requieren al menos %d",
			ErrKeyTooShort, len(signingKey), minSigningKeyBytes)
	}
	return &JWTMaker{signingKey: []byte(signingKey)}, nil
}

// Issue firma un access token nuevo.
//
// T048: generar un `jti` con `uuid.NewRandom` —es la clave de la blacklist, así que
// tiene que ser único e impredecible—, poblar [Claims] con [Issuer], [Audience],
// `AccessTokenTTL` y firmar con `jwt.SigningMethodHS256`.
func (m *JWTMaker) Issue(_ string, _, _ []string) (server.AccessToken, error) {
	_ = m.signingKey
	return server.AccessToken{}, ErrNotImplemented
}

// Parse verifica un token y devuelve sus claims.
//
// T048. Dos exigencias que no son negociables:
//
//   - Fijar el algoritmo esperado con `jwt.WithValidMethods([]string{"HS256"})`. Sin
//     eso, la librería acepta el `alg` que declara el propio token, y el ataque
//     clásico es enviar `alg: none` —o, con clave asimétrica, degradar RS256 a HS256
//     usando la clave pública como secreto HMAC— para fabricar tokens válidos.
//   - Verificar también `iss` y `aud`, no solo la firma y la expiración.
func (m *JWTMaker) Parse(_ string) (server.AccessClaims, error) {
	return server.AccessClaims{}, ErrNotImplemented
}

// Comprobación en tiempo de compilación del implementador.
var _ server.TokenMaker = (*JWTMaker)(nil)
