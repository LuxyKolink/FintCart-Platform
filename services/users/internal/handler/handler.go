package handler

import (
	"context"

	"google.golang.org/grpc"

	commonv1 "github.com/fintcart/platform/services/users/gen/fintcart/common/v1"
	usersv1 "github.com/fintcart/platform/services/users/gen/fintcart/users/v1"
)

// Handler adapta `UsersService` (gRPC) a la capa de aplicación.
//
// Cada método hace exactamente tres cosas y en este orden: desempaquetar el DTO,
// llamar al servicio, empaquetar el resultado. Si alguna vez aparece un `if` de
// negocio aquí, está en la capa equivocada — y es fácil de detectar en revisión
// precisamente porque este archivo es monótono a propósito.
type Handler struct {
	svc Service
}

// New construye el handler sobre la capa de aplicación.
func New(svc Service) *Handler {
	return &Handler{svc: svc}
}

// Register inscribe el handler en un servidor gRPC.
//
// Está aquí y no en `main.go` para que el entrypoint no tenga que conocer el
// nombre del tipo generado: `main.go` construye y arranca, no sabe de contratos
// (Principio X, «entrypoint delgado»).
func (h *Handler) Register(s grpc.ServiceRegistrar) {
	usersv1.RegisterUsersServiceServer(s, h)
}

// Comprobación en tiempo de compilación: si `contracts/` añade un RPC a
// `UsersService`, este servicio deja de compilar en lugar de devolver
// `Unimplemented` en producción.
var _ usersv1.UsersServiceServer = (*Handler)(nil)

// ── Perfil ──────────────────────────────────────────────────────────────────

func (h *Handler) CreateProfile(ctx context.Context, req *usersv1.CreateProfileRequest) (*commonv1.OpResult, error) {
	if err := h.svc.CreateProfile(ctx, req.GetUserId(), req.GetEmail(), req.GetDisplayName()); err != nil {
		return nil, grpcError(err)
	}
	return okResult(), nil
}

func (h *Handler) MarkEmailVerified(ctx context.Context, req *usersv1.UserRef) (*commonv1.OpResult, error) {
	if err := h.svc.MarkEmailVerified(ctx, req.GetUserId()); err != nil {
		return nil, grpcError(err)
	}
	return okResult(), nil
}

func (h *Handler) GetAuthContext(ctx context.Context, req *usersv1.UserRef) (*usersv1.AuthContext, error) {
	out, err := h.svc.GetAuthContext(ctx, req.GetUserId())
	if err != nil {
		return nil, grpcError(err)
	}
	return authContextToProto(out), nil
}

func (h *Handler) GetProfile(ctx context.Context, req *usersv1.UserRef) (*usersv1.Profile, error) {
	out, err := h.svc.GetProfile(ctx, req.GetUserId())
	if err != nil {
		return nil, grpcError(err)
	}
	return profileToProto(out), nil
}

func (h *Handler) UpdateProfile(ctx context.Context, req *usersv1.UpdateProfileRequest) (*commonv1.OpResult, error) {
	if err := h.svc.UpdateProfile(ctx, req.GetUserId(), req.GetDisplayName(), req.GetPreferences()); err != nil {
		return nil, grpcError(err)
	}
	return okResult(), nil
}

// ── Progreso e historiales ──────────────────────────────────────────────────

// ApplyQuizScore pasa el puntaje como `string` sin tocarlo.
//
// El transporte NO parsea el decimal: lo hace la capa de aplicación con el helper
// `decimalstr`. Parsearlo aquí duplicaría la validación y crearía la posibilidad
// de que las dos versiones discrepen, que es peor que no validar dos veces.
func (h *Handler) ApplyQuizScore(ctx context.Context, req *usersv1.ApplyQuizScoreRequest) (*usersv1.ProgressView, error) {
	out, err := h.svc.ApplyQuizScore(ctx, req.GetUserId(), req.GetQuizId(), req.GetScore())
	if err != nil {
		return nil, grpcError(err)
	}
	return progressToProto(out), nil
}

func (h *Handler) GetProgress(ctx context.Context, req *usersv1.UserRef) (*usersv1.ProgressView, error) {
	out, err := h.svc.GetProgress(ctx, req.GetUserId())
	if err != nil {
		return nil, grpcError(err)
	}
	return progressToProto(out), nil
}

func (h *Handler) RecordArticleView(ctx context.Context, req *usersv1.RecordArticleViewRequest) (*commonv1.OpResult, error) {
	if err := h.svc.RecordArticleView(ctx, req.GetUserId(), req.GetArticleId()); err != nil {
		return nil, grpcError(err)
	}
	return okResult(), nil
}

// ── Bandeja in-app ──────────────────────────────────────────────────────────

func (h *Handler) AppendInAppNotification(ctx context.Context, req *usersv1.InAppNotification) (*commonv1.OpResult, error) {
	if err := h.svc.AppendInAppNotification(ctx, req.GetUserId(), req.GetType(), req.GetPayloadJson()); err != nil {
		return nil, grpcError(err)
	}
	return okResult(), nil
}

// ListInAppNotifications traduce el token opaco del contrato a límite y
// desplazamiento, que es lo único que entiende la capa de abajo.
//
// La paginación por token es transporte: el dominio pagina por `(limit, offset)` y
// no sabe que existe un token, así que cambiar a un cursor por `created_at` más
// adelante no toca ni `server` ni `storer`.
func (h *Handler) ListInAppNotifications(ctx context.Context, req *usersv1.ListInAppRequest) (*usersv1.ListInAppResponse, error) {
	offset, err := decodePageToken(req.GetPage().GetPageToken())
	if err != nil {
		return nil, grpcError(err)
	}
	pageSize := clampPageSize(req.GetPage().GetPageSize())

	page, err := h.svc.ListInAppNotifications(ctx, req.GetUserId(), pageSize, offset)
	if err != nil {
		return nil, grpcError(err)
	}
	return inAppPageToProto(page, offset, pageSize), nil
}

func (h *Handler) MarkNotificationRead(ctx context.Context, req *usersv1.MarkReadRequest) (*commonv1.OpResult, error) {
	if err := h.svc.MarkNotificationRead(ctx, req.GetUserId(), req.GetNotificationId()); err != nil {
		return nil, grpcError(err)
	}
	return okResult(), nil
}

// ── Reporte y anonimización ─────────────────────────────────────────────────

func (h *Handler) GetActivityReport(ctx context.Context, req *usersv1.UserRef) (*usersv1.ActivityReport, error) {
	out, err := h.svc.GetActivityReport(ctx, req.GetUserId())
	if err != nil {
		return nil, grpcError(err)
	}
	return activityReportToProto(out), nil
}

func (h *Handler) AnonymizeProfile(ctx context.Context, req *usersv1.UserRef) (*commonv1.OpResult, error) {
	if err := h.svc.AnonymizeProfile(ctx, req.GetUserId()); err != nil {
		return nil, grpcError(err)
	}
	return okResult(), nil
}
