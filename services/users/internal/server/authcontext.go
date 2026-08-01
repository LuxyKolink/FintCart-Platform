package server

import (
	"context"
	"fmt"
)

// Contexto de autorización (research D-04).
//
// Es lo que el Servidor de Autenticación pide por gRPC justo antes de firmar un
// JWT, y por eso vive en su propio archivo: es el único punto del servicio cuyo
// resultado acaba dentro de un token firmado que viaja en cada petición y que
// nadie puede revocar antes de que expire. Todo lo que se añada aquí se vuelve
// público para cualquiera que intercepte el token.

// AuthContext es lo MÍNIMO que Auth necesita para poblar los claims.
//
// Es un tipo aparte de [Profile] y no un subconjunto suyo por una razón de
// seguridad, no de estilo: si Auth recibiera un `Profile` completo, el correo y
// el nombre acabarían dentro del token. Este struct hace imposible ese descuido
// por construcción — para filtrar un dato personal habría que añadirle un campo a
// mano, que es un cambio visible en revisión.
type AuthContext struct {
	UserID        string
	Roles         []string
	AccountStatus string
	EmailVerified bool
}

// GetAuthContext resuelve roles y estado de cuenta para la emisión de tokens.
//
// Devuelve `account_status` y `email_verified` en vez de decidir aquí si la
// cuenta puede recibir un token. La decisión es de Auth (T091, FR-002) porque
// depende del flujo: un token de restablecimiento de contraseña sí se emite para
// una cuenta sin verificar, y uno de acceso no. Este servicio no conoce esa
// distinción y no debería adquirirla.
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
