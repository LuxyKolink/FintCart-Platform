package util

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/argon2"
)

// contraseña de prueba. Cumple la política de `server.ValidatePasswordPolicy`
// (≥ 12 runas) para que los casos sean representativos.
const testPassword = "contraseña-de-prueba-123"

func TestHashProducesPHCFormat(t *testing.T) {
	t.Parallel()

	h := NewArgon2idHasher()
	hash, err := h.Hash(testPassword)
	require.NoError(t, err)

	// Se comprueba la ESTRUCTURA y no el valor: el hash lleva una sal aleatoria, así
	// que un valor esperado fijo sería imposible de escribir (y si fuera posible,
	// significaría que la sal no es aleatoria).
	require.True(t, strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=4$"),
		"prefijo PHC inesperado: %s", hash)
	require.Len(t, strings.Split(hash, "$"), 6)
}

func TestHashIsSaltedPerCall(t *testing.T) {
	t.Parallel()

	h := NewArgon2idHasher()
	first, err := h.Hash(testPassword)
	require.NoError(t, err)
	second, err := h.Hash(testPassword)
	require.NoError(t, err)

	// La MISMA contraseña debe dar hashes distintos. Si coincidieran, dos usuarios
	// con la misma contraseña serían identificables entre sí con solo mirar la tabla,
	// y una tabla precalculada valdría para toda la base.
	require.NotEqual(t, first, second)
}

func TestVerifyAcceptsCorrectPassword(t *testing.T) {
	t.Parallel()

	h := NewArgon2idHasher()
	hash, err := h.Hash(testPassword)
	require.NoError(t, err)

	ok, err := h.Verify(hash, testPassword)
	require.NoError(t, err)
	require.True(t, ok)
}

func TestVerifyRejectsWrongPassword(t *testing.T) {
	t.Parallel()

	h := NewArgon2idHasher()
	hash, err := h.Hash(testPassword)
	require.NoError(t, err)

	ok, err := h.Verify(hash, testPassword+"x")
	// Contraseña incorrecta NO es un error: es un resultado legítimo. Devolver error
	// aquí haría que la capa de aplicación no pudiera distinguirlo de una fila
	// corrupta.
	require.NoError(t, err)
	require.False(t, ok)
}

func TestVerifyRejectsMalformedHash(t *testing.T) {
	t.Parallel()

	h := NewArgon2idHasher()

	cases := map[string]string{
		"vacío":                 "",
		"sin prefijo":           "argon2id$v=19$m=65536,t=3,p=4$c2FsdA$a2V5",
		"algoritmo distinto":    "$argon2i$v=19$m=65536,t=3,p=4$c2FsdA$a2V5",
		"faltan campos":         "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA",
		"versión ilegible":      "$argon2id$v=xx$m=65536,t=3,p=4$c2FsdA$a2V5",
		"parámetros ilegibles":  "$argon2id$v=19$m=,t=3,p=4$c2FsdA$a2V5",
		"sal no es base64":      "$argon2id$v=19$m=65536,t=3,p=4$!!!$a2V5",
		"clave no es base64":    "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$!!!",
		"parámetros de coste 0": "$argon2id$v=19$m=65536,t=0,p=4$c2FsdA$a2V5",
	}

	for name, hash := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			// Un hash roto DEBE dar error, no `false`: la diferencia entre «la
			// contraseña no coincide» y «la fila está corrupta» decide si el usuario
			// reintenta o si alguien mira la base de datos.
			ok, err := h.Verify(hash, testPassword)
			require.Error(t, err)
			require.False(t, ok)
		})
	}
}

func TestVerifyRejectsIncompatibleVersion(t *testing.T) {
	t.Parallel()

	h := NewArgon2idHasher()
	ok, err := h.Verify("$argon2id$v=16$m=65536,t=3,p=4$c2FsdA$a2V5", testPassword)
	require.ErrorIs(t, err, ErrIncompatibleVersion)
	require.False(t, ok)
}

func TestVerifyUsesParametersFromTheHash(t *testing.T) {
	t.Parallel()

	// Hash fabricado con parámetros DISTINTOS de los del paquete (t=1 en lugar de 3,
	// 8 MiB en lugar de 64). Representa una contraseña guardada antes de recalibrar
	// el coste.
	const (
		otherMemory uint32 = 8 * 1024
		otherTime   uint32 = 1
		otherPar    uint8  = 2
	)
	salt := []byte("dieciseis-bytes.")
	key := argon2.IDKey([]byte(testPassword), salt, otherTime, otherMemory, otherPar, argonKeyLen)
	legacy := fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, otherMemory, otherTime, otherPar,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key))

	// Si `Verify` usara las constantes del paquete en vez de los parámetros del
	// propio hash, derivaría una clave distinta y esto fallaría — que es lo que le
	// pasaría a TODAS las contraseñas de la base el día que se suba el coste.
	ok, err := NewArgon2idHasher().Verify(legacy, testPassword)
	require.NoError(t, err)
	require.True(t, ok)
}

func TestDecodePHCReadsCurrentParameters(t *testing.T) {
	t.Parallel()

	hash, err := NewArgon2idHasher().Hash(testPassword)
	require.NoError(t, err)

	params, salt, key, err := decodePHC(hash)
	require.NoError(t, err)
	require.Equal(t, argonMemoryKiB, params.memoryKiB)
	require.Equal(t, argonTime, params.time)
	require.Equal(t, argonParallelism, params.parallelism)
	require.Len(t, salt, int(argonSaltLen))
	require.Len(t, key, int(argonKeyLen))
}
