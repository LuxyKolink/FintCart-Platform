package server

import (
	"context"
	"fmt"
)

// Flujo Client Credentials para clientes máquina-a-máquina (Principio VII).
//
// Es el segundo y ÚLTIMO flujo permitido por la constitución. No hay usuario
// detrás, así que no hay PKCE ni redirección: el cliente se autentica con su
// propio secreto y obtiene un token que lo representa a él, no a una persona.

// ClientCredentialsToken emite un token M2M contra `oauth_clients`.
//
// Diferencias con el flujo de usuario que T052 debe respetar, y ninguna es
// cosmética:
//
//   - El `sub` del token NO es un usuario: es el `client_id`. Un token M2M que
//     suplantara a un usuario haría imposible distinguir en auditoría una acción
//     de una persona de una de un sistema.
//   - No se emite refresh token. Un cliente M2M tiene su secreto y puede pedir
//     otro access token cuando quiera; un refresh token solo añadiría una
//     credencial de larga vida más que custodiar.
//   - Solo se aceptan clientes con `client_credentials` entre sus `grant_types` y
//     `is_public = false`. Un cliente público no tiene secreto, así que
//     «autenticarse con su secreto» no significa nada.
func (s *Server) ClientCredentialsToken(_ context.Context, clientID, clientSecret string, scopes []string) (TokenPair, error) {
	if clientID == "" || clientSecret == "" {
		return TokenPair{}, fmt.Errorf("%w: client_id y client_secret son obligatorios", ErrInvalidArgument)
	}
	// T052 implementa:
	//   1. `store.GetOAuthClient(clientID)`.
	//   2. Rechazar si `IsPublic` o si `client_credentials` no está en `GrantTypes`.
	//   3. Verificar el secreto con `s.hasher.Verify` — el secreto está hasheado en
	//      la columna, igual que una contraseña, porque un volcado de `oauth_clients`
	//      con secretos en claro es una brecha total de todos los clientes M2M.
	//   4. Comprobar que los `scopes` pedidos son un subconjunto de los registrados.
	_ = scopes
	return TokenPair{}, ErrNotImplemented
}
