// Mapeo explícito de la capa de aplicación del Servidor de Autenticación
// (Principio IX regla 3).
//
// Cubre las dos fronteras de esta capa: fila (`storer`) → dominio, y respuesta
// gRPC ajena → dominio. La frontera proto ↔ dominio del propio `AuthService` está
// en `internal/handler/mapping.go`.
package server

import (
	"context"
	"fmt"

	usersv1 "github.com/fintcart/platform/services/auth-server/gen/fintcart/users/v1"
	"github.com/fintcart/platform/services/auth-server/internal/storer"
)

// ── fila → dominio ──────────────────────────────────────────────────────────

// credentialCheckFromRow construye el resultado de un login EXITOSO.
//
// No recibe la contraseña ni el hash y no puede devolver `Valid: false`: la
// decisión de si las credenciales son válidas la toma
// [Server.ValidateCredentials], y este convertidor solo traduce la fila. Separarlo
// así evita el error clásico de tener dos sitios que deciden qué cuenta puede
// entrar, uno de ellos escondido en un mapeo.
//
// `EmailVerified` se DERIVA de `login_status` en lugar de leerse de una columna
// propia: en `auth_db` el estado es la única fuente de verdad de la verificación
// (`pending_verification` → no verificado), y una columna redundante podría
// contradecirlo.
func credentialCheckFromRow(c storer.CredentialRow) CredentialCheck {
	return CredentialCheck{
		Valid:         true,
		UserID:        c.ID.String(),
		EmailVerified: c.LoginStatus == storer.StatusActive,
		LoginStatus:   c.LoginStatus,
	}
}

// ── respuesta gRPC ajena → dominio ──────────────────────────────────────────

// UsersRolesProvider implementa [AuthContextProvider] preguntando al Servicio de
// Usuarios.
//
// Los roles los posee Usuarios (Principio III) y se piden por gRPC; leerlos de
// `users_db` está prohibido. `cmd/auth/main.go` construye este adaptador con el
// cliente ya conectado.
type UsersRolesProvider struct {
	client usersv1.UsersServiceClient
}

// NewUsersRolesProvider envuelve un cliente gRPC de Usuarios.
func NewUsersRolesProvider(client usersv1.UsersServiceClient) *UsersRolesProvider {
	return &UsersRolesProvider{client: client}
}

// Roles pide el contexto de autorización y extrae solo los roles.
//
// Se descarta a propósito el resto de `AuthContext` —correo y nombre no vienen en
// ese mensaje, y con razón—: este servicio firma tokens, y cualquier dato que
// llegue aquí corre el riesgo de acabar dentro de un JWT, que viaja en cada
// petición y no se puede retirar una vez emitido.
func (p *UsersRolesProvider) Roles(ctx context.Context, userID string) ([]string, error) {
	resp, err := p.client.GetAuthContext(ctx, &usersv1.UserRef{UserId: userID})
	if err != nil {
		return nil, fmt.Errorf("obtener contexto de autorización de %s: %w", userID, err)
	}
	// Una cuenta que no está activa no aporta roles, sin importar lo que diga la
	// tabla de asignaciones: FR-030 exige que una cuenta anonimizada no pueda
	// operar, y devolver sus roles antiguos sería la vía más directa a lo contrario.
	if resp.GetAccountStatus() != "active" {
		return nil, nil
	}
	return resp.GetRoles(), nil
}

// El adaptador satisface el puerto: si el contrato de Usuarios cambia de forma
// incompatible, esto falla al compilar y no en producción.
var _ AuthContextProvider = (*UsersRolesProvider)(nil)
