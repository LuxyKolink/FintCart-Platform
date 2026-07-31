package server

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/fintcart/platform/services/auth-server/internal/storer"
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
func (s *Server) ClientCredentialsToken(ctx context.Context, clientID, clientSecret string, scopes []string) (TokenPair, error) {
	if clientID == "" || clientSecret == "" {
		return TokenPair{}, fmt.Errorf("%w: client_id y client_secret son obligatorios", ErrInvalidArgument)
	}

	client, err := s.store.GetOAuthClient(ctx, clientID)
	if err != nil {
		if errors.Is(err, storer.ErrNotFound) {
			// Cliente inexistente y secreto incorrecto dan el MISMO error, igual que en
			// el login de usuario: distinguirlos convertiría este endpoint en un oráculo
			// de qué `client_id` existen.
			return TokenPair{}, ErrUnauthenticated
		}
		return TokenPair{}, fmt.Errorf("leer cliente %s: %w", clientID, err)
	}

	// Un cliente PÚBLICO no tiene secreto, así que «autenticarse con su secreto» no
	// significa nada: aceptarlo permitiría a la SPA —cuyo `client_id` es público por
	// definición— pedir tokens M2M sin credencial alguna.
	if client.IsPublic || client.ClientSecretHash == nil {
		return TokenPair{}, ErrUnauthenticated
	}
	if !slices.Contains(client.GrantTypes, grantClientCredentials) {
		return TokenPair{}, fmt.Errorf("%w: el cliente %s no admite client_credentials", ErrInvalidArgument, clientID)
	}

	// El secreto está HASHEADO en la columna, igual que una contraseña: un volcado de
	// `oauth_clients` con secretos en claro sería una brecha total de todos los
	// clientes M2M a la vez. Se verifica con el mismo hasher, así que la comparación
	// es en tiempo constante.
	ok, err := s.hasher.Verify(*client.ClientSecretHash, clientSecret)
	if err != nil {
		return TokenPair{}, fmt.Errorf("verificar el secreto del cliente %s: %w", clientID, err)
	}
	if !ok {
		return TokenPair{}, ErrUnauthenticated
	}

	if err := checkScopes(scopes, client.Scopes); err != nil {
		return TokenPair{}, err
	}

	// El `sub` es el `client_id`, NO un usuario. Un token M2M que suplantara a una
	// persona haría imposible distinguir en auditoría una acción de un sistema de una
	// acción humana, y `audit_log` es la fuente de trazabilidad regulatoria (FR-025).
	//
	// Los roles van vacíos por lo mismo: un cliente M2M se autoriza por SCOPE, y darle
	// roles de usuario le daría acceso a las rutas de perfil del borde.
	access, err := s.maker.Issue(clientID, nil, scopes)
	if err != nil {
		return TokenPair{}, fmt.Errorf("emitir access token para el cliente %s: %w", clientID, err)
	}

	// Sin refresh token, a propósito: el cliente tiene su secreto y puede pedir otro
	// access token cuando quiera. Un refresh sería una credencial de larga vida más
	// que custodiar, sin ninguna ventaja.
	return TokenPair{
		AccessToken: access.Raw,
		TokenType:   tokenTypeBearer,
		ExpiresIn:   expiresInSeconds(access),
	}, nil
}
