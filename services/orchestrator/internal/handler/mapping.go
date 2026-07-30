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
	return &orchestratorv1.SimulationResult{
		SimulationId: s.SimulationID,
		Result:       s.Result,
	}
}

// ── error de dominio → código gRPC ──────────────────────────────────────────

// grpcError traduce los centinelas internos al código de estado correspondiente.
//
// El mensaje al cliente está saneado: la causa envuelta puede contener el error de
// un servicio interno, con nombres de host y detalle del driver. La causa completa
// va al log.
func grpcError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, server.ErrInvalidArgument):
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
