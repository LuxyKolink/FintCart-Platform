package server

import (
	"context"
	"fmt"
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

// AuthContext es lo mínimo que el Servidor de Autenticación necesita para poblar
// los claims de un JWT.
//
// Es un tipo aparte de [Profile] y no un subconjunto suyo por una razón de
// seguridad, no de estilo: si Auth recibiera un `Profile` completo, el correo y el
// nombre acabarían dentro de un token firmado que viaja en cada peticion. Este
// struct hace imposible ese descuido por construcción.
type AuthContext struct {
	UserID        string
	Roles         []string
	AccountStatus string
	EmailVerified bool
}

// CreateProfile crea el perfil en estado no verificado. Paso de la saga de
// registro, y por tanto idempotente (D-04).
func (s *Server) CreateProfile(_ context.Context, userID, email, displayName string) error {
	if _, err := parseUserID(userID); err != nil {
		return err
	}
	// T092: validar el correo y el nombre, y elegir el rol inicial
	// (`usuario_final`) antes de delegar en el storer.
	_, _ = email, displayName
	return ErrNotImplemented
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

// GetAuthContext resuelve roles y estado de cuenta para la emisión de tokens.
func (s *Server) GetAuthContext(ctx context.Context, userID string) (AuthContext, error) {
	id, err := parseUserID(userID)
	if err != nil {
		return AuthContext{}, err
	}
	profile, err := s.store.GetProfile(ctx, id)
	if err != nil {
		return AuthContext{}, fmt.Errorf("leer perfil para contexto de autorización: %w", err)
	}
	roles, err := s.store.GetRoles(ctx, id)
	if err != nil {
		return AuthContext{}, fmt.Errorf("leer roles: %w", err)
	}
	return authContextFromRows(profile, roles), nil
}

// GetProfile devuelve el perfil completo con preferencias y roles (FR-017).
func (s *Server) GetProfile(_ context.Context, userID string) (Profile, error) {
	if _, err := parseUserID(userID); err != nil {
		return Profile{}, err
	}
	// T158: las tres lecturas (perfil, preferencias, roles) y el ensamblado con
	// `profileFromRows`. Se dejan explícitas y no dentro de una única consulta con
	// JOIN porque las preferencias son un documento JSONB y aplanarlo en el SQL
	// mezclaría el mapeo con la consulta.
	return Profile{}, ErrNotImplemented
}

// UpdateProfile aplica una rectificación de datos personales (FR-029).
func (s *Server) UpdateProfile(_ context.Context, userID, displayName string, preferences map[string]string) error {
	if _, err := parseUserID(userID); err != nil {
		return err
	}
	// T159: validar el nombre, convertir el mapa con `preferencesToRow` y escribir
	// nombre y preferencias en la misma transacción del storer.
	_, _ = displayName, preferences
	return ErrNotImplemented
}
