// Mapeo de la frontera de transporte del Orquestador y traducción de errores a
// códigos gRPC (Principio IX regla 3).
package handler

import (
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	orchestratorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/orchestrator/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/server"
)

// ── dominio → proto ─────────────────────────────────────────────────────────

func sagaHandleToProto(sagaID string) *orchestratorv1.SagaHandle {
	return &orchestratorv1.SagaHandle{SagaId: sagaID}
}

func sagaStatusToProto(s server.SagaStatus) *orchestratorv1.SagaStatus {
	return &orchestratorv1.SagaStatus{
		SagaId:      s.SagaID,
		SagaType:    s.SagaType,
		Status:      s.Status,
		CurrentStep: s.CurrentStep,
	}
}

// quizGradingToProto reenvía `Score` como la `string` decimal que es.
//
// El campo del contrato es `string` y está marcado `[decimal]`; aquí no se parsea ni
// se reformatea. Reformatearlo —por ejemplo, forzando dos decimales— cambiaría un
// valor que Aprendizaje ya emitió en forma canónica, y entonces el `score` que ve el
// usuario y el que quedó auditado podrían no coincidir (Principio VIII).
func quizGradingToProto(g server.QuizGrading) *orchestratorv1.QuizGradingResult {
	return &orchestratorv1.QuizGradingResult{
		AttemptId:   g.AttemptID,
		AttemptNo:   g.AttemptNo,
		Score:       g.Score,
		Passed:      g.Passed,
		PointsAfter: g.PointsAfter,
	}
}

func simulationToProto(s server.Simulation) *orchestratorv1.SimulationResult {
	// Los indicadores salen SIEMPRE, vacíos si no hay: el cliente que recorre la procedencia no
	// tiene que distinguir «sin indicadores» de «campo ausente» (mismo criterio que el historial).
	indicators := s.IndicatorsUsed
	if indicators == nil {
		indicators = map[string]string{}
	}
	return &orchestratorv1.SimulationResult{
		SimulationId:      s.SimulationID,
		Result:            s.Result,
		CalculatorVersion: s.CalculatorVersion,
		IndicatorsUsed:    indicators,
	}
}

func calculatorApprovalToProto(a server.CalculatorApproval) *orchestratorv1.CalculatorApprovalResult {
	return &orchestratorv1.CalculatorApprovalResult{
		CalculatorId: a.CalculatorID,
		Version:      a.Version,
	}
}

// ── error de dominio → código gRPC ──────────────────────────────────────────

// deepestStatus busca el error de estado gRPC más PROFUNDO de la cadena de causas.
//
// La profundidad es lo que importa y no la superficie: el error de un servicio interno viaja
// envuelto por los pasos de la saga y por la capa de este servicio, y el que tiene el mensaje
// redactado para quien llama es el de dentro —el del participante que rechazó la operación—.
//
// ## Por qué no basta con `errors.Unwrap`
//
// Porque este proyecto envuelve con DOS verbos: `fmt.Errorf("%w: %w", centinela, causa)`. Desde Go
// 1.20 eso construye un error con `Unwrap() []error`, y `errors.Unwrap` —el singular— devuelve
// `nil` para él: se quedaría en el primer nivel y devolvería justo el aplanado que se quiere
// evitar. La primera versión de esta ayuda hacía eso, y la prueba que la acompaña lo cazó porque
// no se conformaba con que el código fuera el correcto: comprobaba el MENSAJE.
//
// Se recorre el árbol entero, visitando los hijos en orden. El último estado que gana es el más
// profundo —el hijo es la causa del padre—, y ese es el que hay que contar.
func deepestStatus(err error) (*status.Status, bool) {
	var encontrado *status.Status
	var hay bool

	var recorre func(error)
	recorre = func(actual error) {
		if actual == nil {
			return
		}
		if st, ok := status.FromError(actual); ok && st.Code() != codes.Unknown {
			encontrado, hay = st, true
		}

		switch envuelto := actual.(type) {
		case interface{ Unwrap() []error }:
			for _, hijo := range envuelto.Unwrap() {
				recorre(hijo)
			}
		case interface{ Unwrap() error }:
			recorre(envuelto.Unwrap())
		}
	}

	recorre(err)
	return encontrado, hay
}

// grpcError traduce los centinelas internos al código de estado correspondiente.
//
// El mensaje al cliente está saneado: la causa envuelta puede contener el error de
// un servicio interno, con nombres de host y detalle del driver. La causa completa
// va al log.
func grpcError(err error) error {
	// Un error que YA lleva un código gRPC —típicamente de un servicio interno como
	// Aprendizaje, que rechaza una sesión inválida con FAILED_PRECONDITION— se propaga
	// tal cual. Colapsarlo a `Internal` aquí convertiría un 409 legítimo en un 500 en el
	// borde. Los centinelas propios de este servicio NO llevan código y caen en el
	// switch de abajo.
	if err == nil {
		return nil
	}
	// Un estado gRPC en cualquier punto de la cadena MANDA, y se toma el más PROFUNDO.
	//
	// `status.FromError` por sí solo no basta: sobre un error envuelto devuelve un estado cuyo
	// código es el del participante pero cuyo mensaje es el de la cadena ENTERA —es lo que
	// documenta su implementación, que reconstruye el estado con `err.Error()`—. Con él se
	// propagaba «server: argumento inválido: … rpc error: code = InvalidArgument desc = El monto
	// tiene que superar 1000». `deepestStatus` baja hasta el error original del servicio interno,
	// que es el único cuyo mensaje se redactó para quien llama.
	if st, ok := deepestStatus(err); ok {
		return status.Error(st.Code(), st.Message())
	}
	switch {
	case errors.Is(err, server.ErrInvalidArgument):
		// Un rechazo de un PARTICIPANTE viaja con SU mensaje, no con la cadena entera.
		//
		// ## El defecto que esto corrige
		//
		// `ErrInvalidArgument` envuelve causas muy distintas: una petición mal formada de este
		// servicio —«saga_id no es un UUID»— y el fallo de una saga cuyo paso fue rechazado por
		// otro servicio. En el segundo caso, `err.Error()` era la cadena completa, y el borde la
		// mandaba al usuario tal cual:
		//
		//     server: argumento inválido: server: saga fallida y compensada (simulacion):
		//     paso 0 (simulator.compute): ejecutar la simulación de f2bc1b21-…:
		//     rpc error: code = InvalidArgument desc = El monto tiene que superar 1000
		//
		// El mensaje útil —el que el autor de la calculadora escribió para quien la usa
		// (FR-045)— estaba al final del párrafo, detrás de nombres de servicio, un identificador
		// de usuario y el formato interno de gRPC.
		//
		// ## Qué se conserva y dónde
		//
		// La cadena NO se pierde: el motor de sagas la escribió en `saga_state.last_error` al
		// marcar la saga como fallida, que es el registro durable de por qué falló y sobrevive al
		// log. Lo que se deja de transmitir al cliente es el rastro técnico.
		//
		// Aquí solo llega una petición mal formada DE ESTE servicio —«saga_id no es un UUID»—:
		// un rechazo de un participante ya salió arriba con su código y su mensaje.
		return status.Error(codes.InvalidArgument, err.Error())
	case errors.Is(err, server.ErrUnknownSagaType):
		// Internal y no InvalidArgument: el tipo de saga no lo elige el cliente, lo
		// elige este servicio. Que no esté registrado es un error de configuración
		// nuestro, y presentarlo como culpa del llamante mandaría a depurar al sitio
		// equivocado.
		return status.Error(codes.Internal, "error interno")
	case errors.Is(err, server.ErrNotFound):
		return status.Error(codes.NotFound, "saga no encontrada")
	case errors.Is(err, server.ErrConflict):
		return status.Error(codes.FailedPrecondition, "la operación choca con el estado actual")
	case errors.Is(err, server.ErrNotImplemented):
		return status.Error(codes.Unimplemented, "operación no implementada todavía")
	default:
		return status.Error(codes.Internal, "error interno")
	}
}
