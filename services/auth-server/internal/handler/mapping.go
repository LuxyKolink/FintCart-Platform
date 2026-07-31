// Mapeo explícito de la frontera de transporte (Principio IX regla 3) y
// traducción de errores de dominio a códigos gRPC.
package handler

import (
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	authv1 "github.com/fintcart/platform/services/auth-server/gen/fintcart/auth/v1"
	commonv1 "github.com/fintcart/platform/services/auth-server/gen/fintcart/common/v1"
	"github.com/fintcart/platform/services/auth-server/internal/server"
)

// ── dominio → proto ─────────────────────────────────────────────────────────

func credentialCheckToProto(c server.CredentialCheck) *authv1.ValidateCredentialsResponse {
	return &authv1.ValidateCredentialsResponse{
		Valid:         c.Valid,
		UserId:        c.UserID,
		EmailVerified: c.EmailVerified,
		LoginStatus:   c.LoginStatus,
	}
}

func tokenPairToProto(t server.TokenPair) *authv1.TokenResponse {
	return &authv1.TokenResponse{
		AccessToken:  t.AccessToken,
		RefreshToken: t.RefreshToken,
		TokenType:    t.TokenType,
		ExpiresIn:    t.ExpiresIn,
	}
}

// introspectionToProto serializa `exp` como epoch en segundos, que es lo que
// declara el contrato (`IntrospectResponse.exp`, int64) y lo que espera cualquier
// cliente OAuth2 por RFC 7662.
//
// Un token inactivo se devuelve con `Active: false` y SIN los demás campos: la
// respuesta de introspección de un token revocado no debe filtrar a quién
// pertenecía ni qué roles tenía.
func introspectionToProto(i server.Introspection) *authv1.IntrospectResponse {
	if !i.Active {
		return &authv1.IntrospectResponse{Active: false}
	}
	return &authv1.IntrospectResponse{
		Active: true,
		UserId: i.UserID,
		Roles:  i.Roles,
		Jti:    i.JTI,
		Exp:    i.ExpiresAt.Unix(),
	}
}

// okResult es la respuesta de éxito de las operaciones de comando. Un FALLO no
// viaja como `success: false`, sino como error gRPC, para que el cliente no tenga
// dos caminos que comprobar y se olvide de uno.
func okResult() *commonv1.OpResult {
	return &commonv1.OpResult{Success: true}
}

// ── error de dominio → código gRPC ──────────────────────────────────────────

// grpcError traduce los centinelas internos al código de estado correspondiente.
//
// El mensaje que sale al cliente está saneado: la causa envuelta puede contener
// nombres de tabla, SQL o detalle del driver, y en este servicio también pistas
// sobre la existencia de una cuenta. La causa completa va al log.
func grpcError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, server.ErrInvalidArgument):
		return status.Error(codes.InvalidArgument, err.Error())
	case errors.Is(err, server.ErrWeakPassword):
		// El motivo SÍ se devuelve aquí: quien elige una contraseña necesita saber
		// por qué se rechazó, y el mensaje no revela nada sobre otra cuenta.
		return status.Error(codes.InvalidArgument, err.Error())
	case errors.Is(err, server.ErrUnauthenticated):
		// Mensaje fijo y genérico: no debe distinguir «no existe» de «contraseña
		// incorrecta» ni de «cuenta no verificada».
		return status.Error(codes.Unauthenticated, "credenciales inválidas")
	case errors.Is(err, server.ErrPKCEVerificationFailed),
		errors.Is(err, server.ErrTokenReuse):
		// Los dos casos comparten mensaje —y con el del código caducado, que llega
		// como `ErrConflict`— a propósito. Un fallo de PKCE significa que quien canjea
		// no inició el flujo, y una reutilización de refresh token que alguien guardó
		// una copia: en los dos, decirle al cliente cuál de los dos ocurrió le confirma
		// que su código o su token llegó a ser válido. En el LOG sí se distinguen, que
		// es donde la diferencia sirve para algo.
		return status.Error(codes.Unauthenticated, "el canje no es válido")
	case errors.Is(err, server.ErrNotFound):
		return status.Error(codes.NotFound, "recurso no encontrado")
	case errors.Is(err, server.ErrConflict):
		return status.Error(codes.FailedPrecondition, "la operación choca con el estado actual")
	case errors.Is(err, server.ErrNotImplemented):
		return status.Error(codes.Unimplemented, "operación no implementada todavía")
	default:
		return status.Error(codes.Internal, "error interno")
	}
}
