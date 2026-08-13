package server

import (
	"context"
	"fmt"
	"net/mail"
	"strings"
	"unicode/utf8"

	"github.com/fintcart/platform/services/users/internal/storer"
)

// Tipos de DOMINIO del perfil. No son los DTO del contrato ni las filas de la
// base: `handler/mapping.go` convierte proto ↔ estos, y `mapping.go` de este
// paquete convierte estos ↔ filas.

// Profile es la vista de dominio de una cuenta (FR-017, FR-029).
type Profile struct {
	UserID        string
	Email         string
	DisplayName   string
	EmailVerified bool
	AccountStatus string
	Preferences   map[string]string
	Roles         []string
}

// Roles del sistema (FR-006). Coinciden con el CHECK de `roles_assignment`; la
// tabla es la última barrera, pero el rechazo tiene que ocurrir aquí para que un
// rol inválido salga como argumento inválido y no como violación de constraint.
const (
	RoleEndUser              = "usuario_final"
	RoleEditor               = "editor"
	RoleEditorialCoordinator = "coordinador_editorial"
)

// maxDisplayNameLen acota el nombre visible.
//
// La columna es `TEXT` y no impone límite, así que el límite es de dominio: sin
// él, un nombre de un megabyte se almacena sin protestar y luego aparece en cada
// listado, cada notificación y cada token que lo incluya.
const maxDisplayNameLen = 120

// CreateProfile crea el perfil en estado no verificado. Paso de la saga de
// registro, y por tanto idempotente (D-04).
//
// El rol inicial es siempre `usuario_final` y NO es un parámetro. Si el rol
// entrara por el contrato, el paso de una saga —o cualquier cosa que pudiera
// invocar este RPC interno— podría crear un coordinador editorial, que es la
// escalada de privilegios más barata que hay. Los ascensos de rol pertenecen al
// flujo editorial (US3) y tienen su propia ruta.
func (s *Server) CreateProfile(ctx context.Context, userID, email, displayName string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	addr, err := normalizeEmail(email)
	if err != nil {
		return err
	}
	name, err := normalizeDisplayName(displayName)
	if err != nil {
		return err
	}

	row := storer.ProfileRow{ID: id, Email: addr, DisplayName: name}
	if err := s.store.CreateProfile(ctx, row, RoleEndUser); err != nil {
		return fmt.Errorf("crear perfil: %w", err)
	}
	return nil
}

// normalizeEmail valida la dirección y devuelve su forma canónica.
//
// Se usa `net/mail` en lugar de una expresión regular propia: la sintaxis de
// RFC 5322 no es regular, y toda expresión escrita a mano acaba rechazando
// direcciones legítimas (`+` en la parte local, dominios largos) o aceptando
// basura. Además se exige que la cadena sea EXACTAMENTE la dirección: `ParseAddress`
// también acepta `Ana <ana@fintcart.co>`, y guardar eso en la columna dejaría un
// correo al que no se puede escribir.
//
// No se pasa a minúsculas: la columna es `CITEXT`, así que la comparación ya es
// insensible a mayúsculas en la base. Normalizarlo aquí además destruiría la
// forma en que el usuario escribió su propia dirección, que es dato suyo.
func normalizeEmail(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("%w: el correo es obligatorio", ErrInvalidArgument)
	}
	addr, err := mail.ParseAddress(trimmed)
	if err != nil || addr.Address != trimmed {
		return "", fmt.Errorf("%w: %q no es una dirección de correo", ErrInvalidArgument, raw)
	}
	return addr.Address, nil
}

// normalizeDisplayName recorta los espacios de los extremos y acota la longitud.
//
// Se mide en RUNAS y no en bytes: un nombre en cualquier alfabeto no latino
// ocupa varios bytes por carácter, y un límite en bytes lo truncaría mucho antes
// —además de poder partir un carácter por la mitad—.
func normalizeDisplayName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", fmt.Errorf("%w: el nombre visible es obligatorio", ErrInvalidArgument)
	}
	if utf8.RuneCountInString(name) > maxDisplayNameLen {
		return "", fmt.Errorf("%w: el nombre visible excede %d caracteres",
			ErrInvalidArgument, maxDisplayNameLen)
	}
	return name, nil
}

// MarkEmailVerified cierra la saga de verificación de correo (FR-002).
func (s *Server) MarkEmailVerified(ctx context.Context, userID string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	if err := s.store.MarkEmailVerified(ctx, id); err != nil {
		return fmt.Errorf("marcar correo verificado: %w", err)
	}
	return nil
}

// GetProfile devuelve el perfil completo con preferencias y roles (FR-017).
//
// Son tres lecturas explícitas y no una única consulta con JOIN: las preferencias
// son un documento JSONB y aplanarlo en el SQL mezclaría el mapeo con la consulta
// (Principio IX regla 3, «DTO ≠ dominio ≠ fila»).
func (s *Server) GetProfile(ctx context.Context, userID string) (Profile, error) {
	id, err := parseUserID(userID)
	if err != nil {
		return Profile{}, err
	}

	profile, err := s.store.GetProfile(ctx, id)
	if err != nil {
		return Profile{}, fmt.Errorf("leer perfil: %w", err)
	}
	prefs, err := s.store.GetPreferences(ctx, id)
	if err != nil {
		return Profile{}, fmt.Errorf("leer preferencias: %w", err)
	}
	roles, err := s.store.GetRoles(ctx, id)
	if err != nil {
		return Profile{}, fmt.Errorf("leer roles: %w", err)
	}

	return profileFromRows(profile, prefs, roles), nil
}

// UpdateProfile aplica una rectificación de datos personales (FR-029).
//
// `displayName` vacío y `preferences` vacío significan «no cambies esto», no
// «bórralo»: el contrato gRPC no tiene máscara de campos (ver el comentario del
// Gateway en `handler/me.go::UpdateProfile`), así que esta es la única señal
// disponible para distinguir ausencia de vaciado intencional.
func (s *Server) UpdateProfile(ctx context.Context, userID, displayName string, preferences map[string]string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}

	if displayName != "" {
		name, err := normalizeDisplayName(displayName)
		if err != nil {
			return err
		}
		if err := s.store.UpdateDisplayName(ctx, id, name); err != nil {
			return fmt.Errorf("actualizar nombre visible: %w", err)
		}
	}

	if len(preferences) > 0 {
		current, err := s.store.GetPreferences(ctx, id)
		if err != nil {
			return fmt.Errorf("leer preferencias actuales: %w", err)
		}
		row, err := preferencesToRow(id, current, preferences)
		if err != nil {
			return err
		}
		if err := s.store.UpsertPreferences(ctx, row); err != nil {
			return fmt.Errorf("guardar preferencias: %w", err)
		}
	}

	return nil
}
