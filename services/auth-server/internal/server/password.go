package server

import (
	"context"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"
)

// Política de contraseñas y el puerto de hash.
//
// El ALGORITMO no está aquí: Argon2id vive en `internal/util/password.go` (T047).
// Esta capa define qué se le exige a una contraseña y cómo se verifica, no cómo se
// deriva la clave. La separación permite cambiar los parámetros de coste de Argon2
// —que se ajustan al hardware y cambian con el tiempo— sin tocar ninguna regla de
// negocio.

// PasswordHasher es el puerto de derivación y verificación.
//
// `Verify` recibe el hash y la contraseña en claro y devuelve un booleano en lugar
// de comparar cadenas fuera: la comparación debe ser en tiempo constante y la
// implementación de Argon2id ya lo hace. Sacar el hash calculado para compararlo
// aquí con `==` reintroduciría un canal lateral de temporización.
type PasswordHasher interface {
	Hash(plain string) (string, error)
	Verify(hash, plain string) (bool, error)
}

// Errores de política.
var (
	// ErrWeakPassword: la contraseña no cumple la política.
	ErrWeakPassword = errors.New("server: la contraseña no cumple la política")
)

// Límites de la política de contraseñas.
//
// El máximo existe y no es arbitrario: Argon2id trabaja sobre la entrada completa,
// así que una contraseña de un megabyte es una denegación de servicio gratuita
// —cada intento de login consumiría CPU y memoria proporcionales a su tamaño—.
// Se acota en caracteres, no en bytes, para no penalizar acentos ni emoji.
const (
	minPasswordRunes = 12
	maxPasswordRunes = 128
)

// ValidatePasswordPolicy comprueba la política antes de derivar el hash.
//
// Se valida ANTES de llamar al hasher, no después: derivar un Argon2id de una
// contraseña que se va a rechazar de todos modos es trabajo caro tirado a la basura
// y un vector de agotamiento de CPU trivial de explotar.
//
// Longitud mínima sin exigir clases de caracteres es intencionado y sigue la
// recomendación vigente del NIST (SP 800-63B): obligar a «una mayúscula, un número
// y un símbolo» produce contraseñas predecibles alrededor de esas reglas y no
// aumenta la entropía real tanto como cuatro caracteres más.
func ValidatePasswordPolicy(plain string) error {
	if !utf8.ValidString(plain) {
		return fmt.Errorf("%w: no es UTF-8 válido", ErrWeakPassword)
	}
	n := utf8.RuneCountInString(plain)
	switch {
	case n < minPasswordRunes:
		return fmt.Errorf("%w: mínimo %d caracteres", ErrWeakPassword, minPasswordRunes)
	case n > maxPasswordRunes:
		return fmt.Errorf("%w: máximo %d caracteres", ErrWeakPassword, maxPasswordRunes)
	default:
		return nil
	}
}

// ChangePassword sustituye la contraseña de una credencial existente (FR-005).
//
// Exige la contraseña ACTUAL: quien llama es un usuario ya autenticado que actúa
// desde su perfil (a diferencia de un restablecimiento por enlace de correo, que
// no tiene RPC propio todavía — ver el comentario de `ChangePasswordRequest` en
// `auth.proto`), así que la prueba de identidad apropiada es la contraseña
// vigente y no un token de un solo uso.
func (s *Server) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	if err := ValidatePasswordPolicy(newPassword); err != nil {
		return err
	}

	cred, err := s.store.GetCredential(ctx, id)
	if err != nil {
		return fmt.Errorf("leer credencial: %w", err)
	}
	ok, err := s.hasher.Verify(cred.PasswordHash, currentPassword)
	if err != nil {
		return fmt.Errorf("verificar contraseña actual: %w", err)
	}
	if !ok {
		return ErrUnauthenticated
	}

	hash, err := s.hasher.Hash(newPassword)
	if err != nil {
		return fmt.Errorf("derivar hash de contraseña: %w", err)
	}
	if err := s.store.UpdatePasswordHash(ctx, id, hash); err != nil {
		return fmt.Errorf("actualizar hash de contraseña: %w", err)
	}

	// Cambiar la contraseña DEBE invalidar las sesiones abiertas (los refresh
	// tokens del usuario), o un atacante que ya tenga una sesión la conserva justo
	// cuando la víctima cree haberla cerrado. Si esto falla se propaga como error:
	// la contraseña ya cambió, pero devolver éxito sin haber cerrado las sesiones
	// antiguas prometería una garantía de seguridad que no se cumplió.
	if err := s.tokens.InvalidateFamily(ctx, id); err != nil {
		return fmt.Errorf("invalidar sesiones tras el cambio de contraseña: %w", err)
	}

	s.events.Publish(ctx, Event{
		Type:     EventAuthPasswordChanged,
		ActorRef: id.String(),
		Payload: map[string]any{
			"user_id":    id.String(),
			"email":      cred.Email,
			"changed_at": time.Now().UTC().Format(time.RFC3339),
		},
	})
	return nil
}
