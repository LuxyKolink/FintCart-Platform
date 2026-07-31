// Derivación y verificación de contraseñas con Argon2id (T047).
//
// Este paquete implementa `server.PasswordHasher` y es lo único del servicio que
// toca primitivas criptográficas. La separación importa: la política —qué longitud
// se exige, qué se rechaza— vive en `internal/server/password.go` y cambia por
// razones de producto, mientras que los parámetros de coste de aquí cambian por
// razones de hardware. Mezclarlas obligaría a revisar reglas de negocio cada vez que
// se recalibra el coste.
//
// Argon2id y no bcrypt ni PBKDF2: es la variante recomendada por el RFC 9106 y la
// única de las tres que endurece a la vez contra GPU (coste en memoria) y contra
// ataques de canal lateral (la parte «id» combina Argon2i y Argon2d).
//
// NUNCA se registra la contraseña en claro, ni el hash, ni la sal. No hay un
// `slog.Logger` en este paquete y esa ausencia es deliberada: sin logger no hay
// forma de que un `logger.Debug("verificando", plain)` se cuele en una depuración y
// sobreviva a la revisión. Por lo mismo, ningún error de aquí interpola el material
// secreto — ni siquiera su longitud.
package util

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"

	"github.com/fintcart/platform/services/auth-server/internal/server"
)

// ErrInvalidHash marca un hash almacenado que no se puede interpretar.
//
// Es un error DISTINTO de «la contraseña no coincide», y confundirlos convertiría
// una fila corrupta en la base en «el usuario se equivocó de contraseña»: el usuario
// reintentaría indefinidamente y nadie miraría la base de datos.
var ErrInvalidHash = errors.New("util: el hash almacenado no tiene el formato PHC de argon2id")

// ErrIncompatibleVersion rechaza un hash producido por otra versión de Argon2.
var ErrIncompatibleVersion = errors.New("util: versión de argon2 incompatible")

// Parámetros de coste de Argon2id (RFC 9106, perfil de segunda recomendación).
//
// Se declaran como constantes y NO como variables de entorno aunque parezca
// configuración: cambiarlos invalidaría los hashes ya almacenados si no viajaran
// dentro del propio hash. Como el formato PHC que se emite aquí los incluye,
// `Verify` lee los parámetros del hash que verifica y estas constantes solo afectan
// a los hashes NUEVOS — que es justo lo que permite recalibrar el coste sin migrar
// ni una fila.
const (
	// argonMemoryKiB: 64 MiB. Es la palanca que encarece el ataque con GPU, donde la
	// memoria —y no el cómputo— es el recurso escaso.
	argonMemoryKiB uint32 = 64 * 1024
	// argonTime: número de pasadas.
	argonTime uint32 = 3
	// argonParallelism: hilos.
	argonParallelism uint8 = 4
	// argonSaltLen y argonKeyLen en bytes.
	argonSaltLen uint32 = 16
	argonKeyLen  uint32 = 32

	// maxKeyLen acota la clave derivada que se acepta de un hash almacenado. 64 bytes
	// cubre SHA-512 con holgura; por encima de eso, la fila está manipulada.
	maxKeyLen = 64
)

// phcPrefix identifica el algoritmo dentro del formato PHC.
const phcPrefix = "argon2id"

// Argon2idHasher implementa [server.PasswordHasher].
//
// No tiene campos: los parámetros son constantes del paquete y la sal se genera por
// hash. Se mantiene como tipo —y no como funciones sueltas— porque el puerto es una
// interfaz, y un tipo nombrado es lo que permite sustituirlo en un test por un doble
// barato: derivar un Argon2id real por caso de prueba haría los tests de la capa de
// aplicación inaceptablemente lentos, y son 64 MiB por invocación.
type Argon2idHasher struct{}

// NewArgon2idHasher construye el hasher.
func NewArgon2idHasher() *Argon2idHasher {
	return &Argon2idHasher{}
}

// Hash deriva el hash PHC de una contraseña en claro.
//
// El formato de salida es el estándar PHC:
//
//	$argon2id$v=19$m=65536,t=3,p=4$<sal-b64>$<clave-b64>
//
// Llevar los parámetros dentro es lo que hace que subir el coste no invalide nada:
// los hashes viejos se siguen verificando con los suyos.
func (h *Argon2idHasher) Hash(plain string) (string, error) {
	salt := make([]byte, argonSaltLen)
	// `crypto/rand` y NUNCA `math/rand`: la salida de este último es predecible a
	// partir de su semilla, y una sal predecible permite precalcular tablas que
	// sirven para toda la base de usuarios a la vez. Ese es exactamente el ataque
	// que la sal existe para impedir.
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("util: generar la sal: %w", err)
	}

	key := argon2.IDKey([]byte(plain), salt, argonTime, argonMemoryKiB, argonParallelism, argonKeyLen)

	// `RawStdEncoding` (sin relleno `=`) es lo que fija la especificación PHC.
	return fmt.Sprintf(
		"$%s$v=%d$m=%d,t=%d,p=%d$%s$%s",
		phcPrefix,
		argon2.Version,
		argonMemoryKiB, argonTime, argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// Verify comprueba una contraseña contra su hash.
//
// Deriva con los parámetros que trae el PROPIO hash, no con las constantes del
// paquete: un hash creado antes de recalibrar el coste tiene que seguir
// verificándose, y usar los parámetros actuales daría una clave distinta y un
// rechazo indebido de todas las contraseñas antiguas.
//
// Un hash mal formado devuelve `(false, error)` y no `(false, nil)` — ver
// [ErrInvalidHash].
func (h *Argon2idHasher) Verify(hash, plain string) (bool, error) {
	params, salt, want, err := decodePHC(hash)
	if err != nil {
		return false, err
	}

	// La longitud se acota antes de convertirla a `uint32`. `decodePHC` ya rechaza la
	// clave vacía, y una clave absurdamente larga solo puede venir de una fila
	// manipulada; sin la cota, la conversión sería un desbordamiento silencioso en
	// plataformas de 64 bits.
	if len(want) > maxKeyLen {
		return false, fmt.Errorf("%w: clave derivada de %d bytes", ErrInvalidHash, len(want))
	}
	//nolint:gosec // G115: la conversión es segura por la cota de `maxKeyLen` (64) que
	// se acaba de comprobar; gosec no propaga esa condición.
	keyLen := uint32(len(want))
	got := argon2.IDKey([]byte(plain), salt, params.time, params.memoryKiB, params.parallelism, keyLen)

	// `subtle.ConstantTimeCompare` y NO `bytes.Equal`. El segundo sale en el primer
	// byte distinto, así que el tiempo de respuesta revela cuánto prefijo se acertó y
	// permite reconstruir la clave derivada byte a byte. La diferencia es de
	// nanosegundos y es explotable en red con suficientes muestras.
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// phcParams son los parámetros de coste leídos de un hash.
type phcParams struct {
	memoryKiB   uint32
	time        uint32
	parallelism uint8
}

// decodePHC interpreta `$argon2id$v=19$m=...,t=...,p=...$sal$clave`.
//
// Todos los errores de formato colapsan en [ErrInvalidHash] con la parte concreta en
// el mensaje: quien lea el log necesita saber qué campo falló, y quien reciba la
// respuesta no debe saber nada de esto.
func decodePHC(hash string) (phcParams, []byte, []byte, error) {
	// El formato empieza por `$`, así que `Split` produce un primer elemento vacío:
	// seis partes en total.
	parts := strings.Split(hash, "$")
	const wantParts = 6
	if len(parts) != wantParts || parts[0] != "" || parts[1] != phcPrefix {
		return phcParams{}, nil, nil, fmt.Errorf("%w: estructura inesperada", ErrInvalidHash)
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return phcParams{}, nil, nil, fmt.Errorf("%w: campo de versión ilegible", ErrInvalidHash)
	}
	if version != argon2.Version {
		return phcParams{}, nil, nil, fmt.Errorf("%w: %d, se esperaba %d", ErrIncompatibleVersion, version, argon2.Version)
	}

	var params phcParams
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &params.memoryKiB, &params.time, &params.parallelism); err != nil {
		return phcParams{}, nil, nil, fmt.Errorf("%w: parámetros de coste ilegibles", ErrInvalidHash)
	}
	// Un cero en cualquiera de los tres haría que `argon2.IDKey` entrara en pánico.
	// Un hash manipulado a `t=0` no debe tumbar el servidor de autenticación.
	if params.memoryKiB == 0 || params.time == 0 || params.parallelism == 0 {
		return phcParams{}, nil, nil, fmt.Errorf("%w: parámetros de coste nulos", ErrInvalidHash)
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return phcParams{}, nil, nil, fmt.Errorf("%w: sal ilegible", ErrInvalidHash)
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return phcParams{}, nil, nil, fmt.Errorf("%w: clave derivada ilegible", ErrInvalidHash)
	}
	if len(salt) == 0 || len(key) == 0 {
		return phcParams{}, nil, nil, fmt.Errorf("%w: sal o clave vacías", ErrInvalidHash)
	}

	return params, salt, key, nil
}

// Comprobación en tiempo de compilación del implementador.
var _ server.PasswordHasher = (*Argon2idHasher)(nil)
