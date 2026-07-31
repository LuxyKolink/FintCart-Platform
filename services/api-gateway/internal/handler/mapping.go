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
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/common/v1"
	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
	simulatorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/simulator/v1"
	usersv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/users/v1"
)

// ── proto → DTO ─────────────────────────────────────────────────────────────
//
// Obsérvese que en NINGUNA de estas funciones aparece un `strconv.ParseFloat`, un
// `decimal.NewFromString` ni un reformateo. `score`, `inputs` y `result` se copian
// tal cual llegan. Es la regla 1 del encabezado y es lo único que garantiza que el
// valor que ve el usuario sea byte a byte el que quedó auditado.

func progressToDTO(p *usersv1.ProgressView) Progress {
	return Progress{UserID: p.GetUserId(), Points: p.GetPoints()}
}

func profileToDTO(p *usersv1.Profile) Profile {
	return Profile{
		UserID:        p.GetUserId(),
		Email:         p.GetEmail(),
		DisplayName:   p.GetDisplayName(),
		EmailVerified: p.GetEmailVerified(),
		AccountStatus: p.GetAccountStatus(),
		Preferences:   p.GetPreferences(),
		Roles:         p.GetRoles(),
	}
}

func articleToDTO(a *learningv1.Article) Article {
	return Article{
		ArticleID:        a.GetArticleId(),
		Title:            a.GetTitle(),
		Category:         a.GetCategory(),
		Body:             a.GetBody(),
		CurrentVersionNo: a.GetCurrentVersionNo(),
	}
}

func versionToDTO(v *learningv1.ArticleVersion) ArticleVersion {
	return ArticleVersion{
		VersionID:  v.GetVersionId(),
		ArticleID:  v.GetArticleId(),
		VersionNo:  v.GetVersionNo(),
		State:      v.GetState(),
		CreatedBy:  v.GetCreatedBy(),
		ApprovedBy: v.GetApprovedBy(),
	}
}

// quizGradeToDTO copia `score` SIN tocarlo (Principio VIII).
func quizGradeToDTO(g *orchestratorv1.QuizGradingResult) QuizGradeResult {
	return QuizGradeResult{
		AttemptID:   g.GetAttemptId(),
		AttemptNo:   g.GetAttemptNo(),
		Score:       g.GetScore(),
		Passed:      g.GetPassed(),
		PointsAfter: g.GetPointsAfter(),
	}
}

func simulationToDTO(s *orchestratorv1.SimulationResult) SimulationResult {
	return SimulationResult{
		SimulationID: s.GetSimulationId(),
		Result:       s.GetResult(),
	}
}

func historyEntryToDTO(e *simulatorv1.ListHistoryResponse_Entry) SimulationHistoryEntry {
	return SimulationHistoryEntry{
		SimulationID: e.GetSimulationId(),
		CalcType:     calcTypePathName(e.GetCalcType()),
		Currency:     e.GetCurrency(),
		Inputs:       e.GetInputs(),
		Result:       e.GetResult(),
		CreatedAt:    e.GetCreatedAt(),
	}
}

// inAppToDTO convierte un elemento de la bandeja (FR-023).
//
// `payload_json` se reemite como JSON anidado y no como una cadena con JSON dentro:
// obligar al cliente a un segundo `JSON.parse` es una fuente conocida de errores. Se
// valida antes de incrustarlo — un payload corrupto haría inválida TODA la respuesta,
// convirtiendo un dato malo en una página en blanco, así que en ese caso se omite.
//
// El campo extiende `components.schemas.InAppNotification` del OpenAPI, que solo
// declara id/type/read_state/created_at. Se añade porque una bandeja que muestra el
// tipo pero no el contenido no cumple FR-023; queda anotado para la revisión del
// contrato.
func inAppToDTO(item *usersv1.ListInAppResponse_Item) InAppNotification {
	dto := InAppNotification{
		ID:        item.GetId(),
		Type:      item.GetType(),
		ReadState: item.GetReadState(),
		CreatedAt: item.GetCreatedAt(),
	}
	if raw := item.GetPayloadJson(); raw != "" && json.Valid([]byte(raw)) {
		dto.Payload = json.RawMessage(raw)
	}
	return dto
}

func opToDTO(op *commonv1.OpResult) OpAck {
	return OpAck{Success: op.GetSuccess(), Code: op.GetCode(), Message: op.GetMessage()}
}

// ── traducción del enum de cálculo ──────────────────────────────────────────

// calcTypeByPath traduce el segmento `{calcType}` de la URL al enum del contrato.
//
// La tabla es explícita en lugar de derivarse del nombre del enum. Derivarla
// —quitar el prefijo `CALC_TYPE_` y pasar a minúsculas— acoplaría la URL PÚBLICA al
// nombre interno del símbolo: renombrar un valor del enum cambiaría en silencio una
// ruta que ya está en producción.
var calcTypeByPath = map[string]simulatorv1.CalcType{
	"ahorro":              simulatorv1.CalcType_CALC_TYPE_AHORRO,
	"credito":             simulatorv1.CalcType_CALC_TYPE_CREDITO,
	"presupuesto":         simulatorv1.CalcType_CALC_TYPE_PRESUPUESTO,
	"inversion":           simulatorv1.CalcType_CALC_TYPE_INVERSION,
	"colombia_especifica": simulatorv1.CalcType_CALC_TYPE_COLOMBIA_ESPECIFICA,
}

// calcTypeFromPath resuelve el tipo de cálculo o falla con 400.
//
// Un valor desconocido DEBE ser un error del borde. Si se dejara pasar como el valor
// cero del enum, el Simulador recibiría `CALC_TYPE_UNSPECIFIED` y, en el mejor de los
// casos, devolvería un error confuso; en el peor, alguna implementación futura lo
// interpretaría como «el primero de la lista» y el usuario obtendría el resultado de
// una calculadora que no pidió.
func calcTypeFromPath(segment string) (simulatorv1.CalcType, error) {
	calcType, ok := calcTypeByPath[segment]
	if !ok {
		return simulatorv1.CalcType_CALC_TYPE_UNSPECIFIED,
			fmt.Errorf("%w: tipo de cálculo desconocido: %q", errBadRequest, segment)
	}
	return calcType, nil
}

// calcTypePathName es la inversa, para las respuestas del historial.
func calcTypePathName(calcType simulatorv1.CalcType) string {
	for name, value := range calcTypeByPath {
		if value == calcType {
			return name
		}
	}
	return ""
}

// ── paginación ──────────────────────────────────────────────────────────────

// defaultPageSize y maxPageSize acotan los listados.
//
// El tope existe para que el tamaño de página no sea un vector de amplificación: sin
// él, `?page_size=1000000` haría que una petición barata para el cliente costara una
// consulta enorme al servicio interno.
const (
	defaultPageSize int32 = 20
	maxPageSize     int32 = 100
)

// pageRequestFrom traduce `?page_size=&page_token=` al `PageRequest` del contrato.
//
// Un `page_size` ilegible o fuera de rango se AJUSTA en silencio en lugar de dar 400:
// la paginación es un detalle de presentación y rechazar la petición entera por un
// parámetro cosmético empeora la experiencia sin proteger nada. La contrapartida —que
// el cliente reciba una página de tamaño distinto al pedido— es visible en la propia
// respuesta.
func pageRequestFrom(r *http.Request) *commonv1.PageRequest {
	size := defaultPageSize
	if raw := r.URL.Query().Get("page_size"); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 32); err == nil && parsed > 0 {
			size = min(int32(parsed), maxPageSize)
		}
	}
	return &commonv1.PageRequest{
		PageSize:  size,
		PageToken: r.URL.Query().Get("page_token"),
	}
}

// pageOf arma la envoltura paginada de una respuesta.
//
// `items` se normaliza a un slice vacío y nunca se deja en `nil`: `json.Marshal` de un
// slice nil produce `null`, y un cliente que haga `data.items.map(...)` sobre `null`
// falla. Una lista vacía es `[]`.
func pageOf[T any](items []T, page *commonv1.PageResponse) Page[T] {
	if items == nil {
		items = []T{}
	}
	return Page[T]{
		Items:         items,
		NextPageToken: page.GetNextPageToken(),
		TotalSize:     page.GetTotalSize(),
	}
}

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
