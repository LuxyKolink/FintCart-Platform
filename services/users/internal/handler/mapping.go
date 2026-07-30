// Mapeo explícito de la frontera de TRANSPORTE (Principio IX regla 3).
//
// Dos direcciones y una traducción de errores:
//
//	proto (DTO)  → dominio   ·  al entrar
//	dominio      → proto     ·  al salir
//	error de dominio → código gRPC
//
// Los tipos proto NO pasan de este archivo hacia dentro. La razón práctica: los
// mensajes generados llevan estado interno de protobuf (`sizeCache`, campos
// desconocidos) y su forma la decide `contracts/`, no este servicio. Si un
// `*usersv1.Profile` llegara al storer, un cambio de contrato obligaría a tocar
// SQL, que es exactamente el acoplamiento que el Principio IX rompe.
package handler

import (
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonv1 "github.com/fintcart/platform/services/users/gen/fintcart/common/v1"
	usersv1 "github.com/fintcart/platform/services/users/gen/fintcart/users/v1"
	"github.com/fintcart/platform/services/users/internal/server"
)

// ── dominio → proto ─────────────────────────────────────────────────────────

func authContextToProto(a server.AuthContext) *usersv1.AuthContext {
	return &usersv1.AuthContext{
		UserId:        a.UserID,
		Roles:         a.Roles,
		AccountStatus: a.AccountStatus,
		EmailVerified: a.EmailVerified,
	}
}

func profileToProto(p server.Profile) *usersv1.Profile {
	return &usersv1.Profile{
		UserId:        p.UserID,
		Email:         p.Email,
		DisplayName:   p.DisplayName,
		EmailVerified: p.EmailVerified,
		AccountStatus: p.AccountStatus,
		Preferences:   p.Preferences,
		Roles:         p.Roles,
	}
}

func progressToProto(p server.Progress) *usersv1.ProgressView {
	return &usersv1.ProgressView{UserId: p.UserID, Points: p.Points}
}

func activityReportToProto(r server.ActivityReport) *usersv1.ActivityReport {
	return &usersv1.ActivityReport{
		UserId:           r.UserID,
		Points:           r.Points,
		ArticlesViewed:   r.ArticlesViewed,
		QuizzesAttempted: r.QuizzesAttempted,
		SimulationsRun:   r.SimulationsRun,
	}
}

func inAppPageToProto(page server.InAppPage, offset, pageSize int32) *usersv1.ListInAppResponse {
	items := make([]*usersv1.ListInAppResponse_Item, 0, len(page.Items))
	for _, n := range page.Items {
		items = append(items, &usersv1.ListInAppResponse_Item{
			Id:          n.ID,
			Type:        n.Type,
			PayloadJson: n.PayloadJSON,
			ReadState:   n.ReadState,
			CreatedAt:   n.CreatedAt,
		})
	}
	return &usersv1.ListInAppResponse{
		Items: items,
		Page: &commonv1.PageResponse{
			NextPageToken: encodePageToken(offset, pageSize, page.Total),
			TotalSize:     page.Total,
		},
	}
}

// okResult es la respuesta de éxito de las operaciones de comando.
//
// El contrato usa `OpResult` en lugar de `google.protobuf.Empty` para los
// comandos, así que un éxito tiene que decirlo explícitamente. Nótese que un
// FALLO no se devuelve por aquí con `success: false`: se devuelve como error gRPC,
// para que el cliente no tenga dos caminos distintos que comprobar y se olvide de
// uno.
func okResult() *commonv1.OpResult {
	return &commonv1.OpResult{Success: true}
}

// ── error de dominio → código gRPC ──────────────────────────────────────────

// grpcError traduce los centinelas de las capas internas al código de estado que
// les corresponde.
//
// La traducción vive AQUÍ y no en `server` porque un código gRPC es transporte:
// la capa de aplicación no debe saber que existe `codes.NotFound`, entre otras
// cosas porque el mismo dominio se sirve también por REST a través del Gateway,
// con otro juego de códigos.
//
// El mensaje que se devuelve al cliente es el del centinela, no el del error
// completo: la causa envuelta puede contener nombres de tabla, fragmentos de SQL o
// el detalle del driver, que no deben salir del servicio. La causa sí va al log.
func grpcError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, server.ErrInvalidArgument), errors.Is(err, errBadPageToken):
		return status.Error(codes.InvalidArgument, err.Error())
	case errors.Is(err, server.ErrNotFound):
		return status.Error(codes.NotFound, "recurso no encontrado")
	case errors.Is(err, server.ErrConflict):
		return status.Error(codes.FailedPrecondition, "la operación choca con el estado actual")
	case errors.Is(err, server.ErrNotImplemented):
		// Unimplemented y no Internal: el esqueleto de T024 todavía no tiene
		// cuerpo, y un cliente debe poder distinguir «esto aún no existe» de «esto
		// se rompió».
		return status.Error(codes.Unimplemented, "operación no implementada todavía")
	default:
		return status.Error(codes.Internal, "error interno")
	}
}
