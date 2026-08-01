package handler

import (
	"context"

	"google.golang.org/grpc"

	authv1 "github.com/fintcart/platform/services/auth-server/gen/fintcart/auth/v1"
	commonv1 "github.com/fintcart/platform/services/auth-server/gen/fintcart/common/v1"
)

// Handler adapta `AuthService` (gRPC) a la capa de aplicación.
//
// Este servicio expone gRPC SOLO a servicios internos: el flujo OAuth2 de cara al
// usuario lo traduce el API Gateway en el borde REST (Principio II). Por eso aquí
// no hay redirecciones, ni cookies, ni formularios — nada del protocolo HTTP de
// OAuth2 llega hasta este servicio.
type Handler struct {
	svc Service
}

// New construye el handler sobre la capa de aplicación.
func New(svc Service) *Handler {
	return &Handler{svc: svc}
}

// Register inscribe el handler en un servidor gRPC, para que `cmd/auth/main.go` no
// tenga que conocer el nombre del tipo generado (Principio X).
func (h *Handler) Register(s grpc.ServiceRegistrar) {
	authv1.RegisterAuthServiceServer(s, h)
}

// Si `contracts/` añade un RPC a `AuthService`, esto deja de compilar en lugar de
// devolver `Unimplemented` en producción.
var _ authv1.AuthServiceServer = (*Handler)(nil)

// ── ciclo de vida de la credencial ──────────────────────────────────────────

// CreateCredential recibe la contraseña en claro y la pasa sin registrarla.
//
// Es el único RPC del servicio que transporta una contraseña, y por eso el
// interceptor de log de `middleware.go` NO registra el mensaje de petición. Un log
// de acceso que volcara `req` convertiría cada registro de usuario en una
// contraseña en claro almacenada durante toda la retención de logs.
func (h *Handler) CreateCredential(ctx context.Context, req *authv1.CreateCredentialRequest) (*commonv1.OpResult, error) {
	if err := h.svc.CreateCredential(ctx, req.GetUserId(), req.GetEmail(), req.GetPassword()); err != nil {
		return nil, grpcError(err)
	}
	return okResult(), nil
}

// IssueVerificationToken devuelve el token EN CLARO, y es el único RPC del servicio
// que lo hace.
//
// Igual que `CreateCredential` con la contraseña, depende de que el interceptor de
// log de `middleware.go` no vuelque los mensajes: un log de acceso que registrara la
// respuesta dejaría un enlace de verificación utilizable durante toda la retención
// de logs.
func (h *Handler) IssueVerificationToken(ctx context.Context, req *authv1.UserRef) (*authv1.VerificationToken, error) {
	out, err := h.svc.IssueVerificationToken(ctx, req.GetUserId())
	if err != nil {
		return nil, grpcError(err)
	}
	return verificationTokenToProto(out), nil
}

func (h *Handler) ActivateCredential(ctx context.Context, req *authv1.ActivateCredentialRequest) (*commonv1.OpResult, error) {
	if err := h.svc.ActivateCredential(ctx, req.GetUserId(), req.GetVerificationToken()); err != nil {
		return nil, grpcError(err)
	}
	return okResult(), nil
}

// ValidateCredentials devuelve `valid: false` como respuesta NORMAL.
//
// Unas credenciales incorrectas no son un error del servicio: son el resultado
// esperado de un login fallido. Se reserva el error gRPC para los fallos reales, de
// modo que las métricas de tasa de error no se disparen cada vez que alguien
// escribe mal su contraseña.
func (h *Handler) ValidateCredentials(ctx context.Context, req *authv1.ValidateCredentialsRequest) (*authv1.ValidateCredentialsResponse, error) {
	out, err := h.svc.ValidateCredentials(ctx, req.GetEmail(), req.GetPassword())
	if err != nil {
		return nil, grpcError(err)
	}
	return credentialCheckToProto(out), nil
}

// ── Authorization Code + PKCE ───────────────────────────────────────────────

func (h *Handler) IssueAuthorizationCode(ctx context.Context, req *authv1.IssueAuthCodeRequest) (*authv1.IssueAuthCodeResponse, error) {
	code, err := h.svc.IssueAuthorizationCode(
		ctx,
		req.GetUserId(),
		req.GetClientId(),
		req.GetRedirectUri(),
		req.GetCodeChallenge(),
		req.GetCodeChallengeMethod(),
		req.GetScopes(),
	)
	if err != nil {
		return nil, grpcError(err)
	}
	return &authv1.IssueAuthCodeResponse{Code: code}, nil
}

func (h *Handler) ExchangeCode(ctx context.Context, req *authv1.ExchangeCodeRequest) (*authv1.TokenResponse, error) {
	out, err := h.svc.ExchangeCode(ctx, req.GetCode(), req.GetCodeVerifier(), req.GetClientId(), req.GetRedirectUri())
	if err != nil {
		return nil, grpcError(err)
	}
	return tokenPairToProto(out), nil
}

func (h *Handler) RefreshToken(ctx context.Context, req *authv1.RefreshTokenRequest) (*authv1.TokenResponse, error) {
	out, err := h.svc.RefreshToken(ctx, req.GetRefreshToken())
	if err != nil {
		return nil, grpcError(err)
	}
	return tokenPairToProto(out), nil
}

// ── revocación e introspección ──────────────────────────────────────────────

func (h *Handler) Revoke(ctx context.Context, req *authv1.RevokeRequest) (*commonv1.OpResult, error) {
	if err := h.svc.Revoke(ctx, req.GetToken(), req.GetTokenTypeHint()); err != nil {
		return nil, grpcError(err)
	}
	return okResult(), nil
}

func (h *Handler) Introspect(ctx context.Context, req *authv1.IntrospectRequest) (*authv1.IntrospectResponse, error) {
	out, err := h.svc.Introspect(ctx, req.GetAccessToken())
	if err != nil {
		return nil, grpcError(err)
	}
	return introspectionToProto(out), nil
}

// ── anonimización ───────────────────────────────────────────────────────────

func (h *Handler) RevokeAndAnonymizeCredential(ctx context.Context, req *authv1.UserRef) (*commonv1.OpResult, error) {
	if err := h.svc.RevokeAndAnonymizeCredential(ctx, req.GetUserId()); err != nil {
		return nil, grpcError(err)
	}
	return okResult(), nil
}
