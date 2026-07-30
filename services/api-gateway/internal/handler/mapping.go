// Mapeo REST ↔ gRPC del borde (Principio IX regla 3 y Principio VIII).
//
// Es el único archivo del Gateway donde un mensaje proto se convierte en un DTO JSON y
// al revés. Dos reglas gobiernan todo lo de aquí:
//
//  1. **Los decimales pasan como `string`, sin tocarlos.** No se parsean, no se
//     reformatean y no se redondean. El Gateway no es dueño de ningún monto: cambiar
//     `"85.50"` por `"85.5"` —o peor, por `85.5`— haría que el valor que ve el usuario
//     y el que quedó auditado pudieran no coincidir (Principio VIII, research D-10).
//  2. **Los códigos gRPC se traducen a HTTP en un solo sitio.** Repartir ese
//     `switch` por los handlers garantiza que dos rutas devuelvan códigos distintos
//     para el mismo fallo.
package handler

import (
	"errors"
	"log/slog"
	"net/http"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	usersv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/users/v1"
)

// ── proto → DTO ─────────────────────────────────────────────────────────────

func progressToDTO(p *usersv1.ProgressView) Progress {
	return Progress{UserID: p.GetUserId(), Points: p.GetPoints()}
}

// Los convertidores de perfil, artículo, calificación, simulación y bandeja llegan con
// T055/T059, junto con los handlers que los llaman. No se declaran por adelantado a
// propósito: una función sin llamadas es código muerto que el lint marca, y un
// convertidor a medio escribir es peor que no tenerlo porque parece disponible.
//
// Cuando lleguen, la regla que deben respetar es la del encabezado de este archivo y
// está ya codificada en los DTO de `types.go`: `QuizGradeResult.Score` y los mapas de
// `SimulationResult.Result` son `string`, igual que en el contrato gRPC y en
// `components.schemas.DecimalString` del OpenAPI. Los tres niveles coinciden a
// propósito — en cuanto uno fuera numérico, el valor pasaría por un `float64` en el
// único punto del sistema que el usuario ve.

// ── error → respuesta HTTP ──────────────────────────────────────────────────

// writeGRPCError traduce el error de un servicio interno a una respuesta del borde.
//
// El mensaje que sale es fijo por código y NUNCA el del error: el `status.Message()` de
// un servicio interno puede contener nombres de host, de tabla o el detalle del driver
// —y el borde es exactamente la frontera donde eso no debe cruzar. El error completo va
// al log, que sí tiene el contexto de la petición.
func (h *Handler) writeGRPCError(w http.ResponseWriter, r *http.Request, err error) {
	// Los fallos detectados en el propio borde, antes de llamar a nadie.
	switch {
	case errors.Is(err, errBadRequest):
		writeError(w, http.StatusBadRequest, "bad_request", "petición inválida")
		return
	case errors.Is(err, errUnauthorized):
		writeError(w, http.StatusUnauthorized, "unauthenticated", "no autenticado")
		return
	case errors.Is(err, errNotImplemented):
		writeError(w, http.StatusNotImplemented, "not_implemented", "ruta no implementada todavía")
		return
	}

	code := status.Code(err)
	httpStatus, errCode, message := httpFromGRPC(code)

	// Un 5xx se registra como error y un 4xx como advertencia: el primero es un
	// problema nuestro y debe alertar, el segundo es un cliente equivocado y no.
	level := slog.LevelWarn
	if httpStatus >= http.StatusInternalServerError {
		level = slog.LevelError
	}
	h.logger.LogAttrs(r.Context(), level, "error de servicio interno",
		slog.String("method", r.Method),
		slog.String("path", r.URL.Path),
		slog.String("grpc_code", code.String()),
		slog.String("error", err.Error()),
	)

	writeError(w, httpStatus, errCode, message)
}

// httpFromGRPC es la tabla de traducción de códigos.
//
// `Unavailable` → 503 y `DeadlineExceeded` → 504 son los dos que más importan: los dos
// significan «vuelve a intentarlo», y colapsarlos en un 500 haría que un cliente bien
// escrito no reintentara cuando debería.
func httpFromGRPC(code codes.Code) (int, string, string) {
	switch code {
	case codes.OK:
		return http.StatusOK, "", ""
	case codes.InvalidArgument, codes.OutOfRange, codes.FailedPrecondition:
		return http.StatusBadRequest, "bad_request", "petición inválida"
	case codes.Unauthenticated:
		return http.StatusUnauthorized, "unauthenticated", "no autenticado"
	case codes.PermissionDenied:
		return http.StatusForbidden, "forbidden", "acceso denegado"
	case codes.NotFound:
		return http.StatusNotFound, "not_found", "recurso no encontrado"
	case codes.AlreadyExists, codes.Aborted:
		return http.StatusConflict, "conflict", "conflicto con el estado actual"
	case codes.ResourceExhausted:
		return http.StatusTooManyRequests, "rate_limited", "demasiadas peticiones"
	case codes.Unimplemented:
		return http.StatusNotImplemented, "not_implemented", "operación no disponible"
	case codes.Unavailable:
		return http.StatusServiceUnavailable, "unavailable", "servicio no disponible"
	case codes.DeadlineExceeded:
		return http.StatusGatewayTimeout, "timeout", "el servicio no respondió a tiempo"
	default:
		return http.StatusInternalServerError, "internal", "error interno"
	}
}
