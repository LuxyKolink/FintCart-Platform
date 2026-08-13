// Tipos y contratos de la capa de TRANSPORTE del Servidor de Autenticación
// (Principio IX: la capa más externa; conoce gRPC, no conoce SQL ni Redis).
package handler

import (
	"context"

	"github.com/fintcart/platform/services/auth-server/internal/server"
)

// Service es lo que el transporte necesita de la capa de aplicación.
//
// Se declara en el CONSUMIDOR y no junto al implementador: así el transporte
// enumera lo que usa y la lista no se convierte en una copia de los métodos de
// `*server.Server` que hay que mantener sincronizada a mano.
//
// Los tipos que cruzan son de dominio (`server.TokenPair`, `server.Introspection`),
// nunca proto — la conversión ocurre en `mapping.go`.
//
// Nótese lo que NO aparece en esta lista: `ClientCredentialsToken` existe en la
// capa de aplicación pero no se expone por este contrato gRPC, porque
// `AuthService` no lo declara. El flujo M2M lo atenderá el borde a través de
// `ExchangeCode`/`Introspect` según lo defina T052. `ChangePassword` SÍ aparece
// desde que `auth.proto` ganó su propio RPC (FR-005) — una interfaz que
// enumerase métodos sin RPC detrás mentiría sobre la superficie real del
// servicio.
type Service interface {
	CreateCredential(ctx context.Context, userID, email, password string) error
	IssueVerificationToken(ctx context.Context, userID string) (server.VerificationToken, error)
	ActivateCredential(ctx context.Context, userID, verificationToken string) error
	ValidateCredentials(ctx context.Context, email, password string) (server.CredentialCheck, error)
	IssueAuthorizationCode(
		ctx context.Context,
		userID, clientID, redirectURI, codeChallenge, codeChallengeMethod string,
		scopes []string,
	) (string, error)
	ExchangeCode(ctx context.Context, code, codeVerifier, clientID, redirectURI string) (server.TokenPair, error)
	RefreshToken(ctx context.Context, refreshToken string) (server.TokenPair, error)
	Revoke(ctx context.Context, token, tokenTypeHint string) error
	Introspect(ctx context.Context, accessToken string) (server.Introspection, error)
	RevokeAndAnonymizeCredential(ctx context.Context, userID string) error
	ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error
}
