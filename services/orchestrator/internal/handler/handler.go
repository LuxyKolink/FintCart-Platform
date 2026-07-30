package handler

import (
	"context"

	"google.golang.org/grpc"

	orchestratorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/orchestrator/v1"
)

// Handler adapta `OrchestratorService` (gRPC) a la capa de aplicación.
//
// El Orquestador lo invoca el API Gateway para los flujos que cruzan dos o más
// servicios. No lo invocan los servicios de dominio entre sí: si Aprendizaje
// llamara aquí para coordinar algo, la saga quedaría iniciada desde dentro de otro
// bounded context y su compensación dependería de que ese servicio siguiera vivo.
type Handler struct {
	svc Service
}

// New construye el handler sobre la capa de aplicación.
func New(svc Service) *Handler {
	return &Handler{svc: svc}
}

// Register inscribe el handler en un servidor gRPC (Principio X: `main.go` no
// conoce los tipos generados).
func (h *Handler) Register(s grpc.ServiceRegistrar) {
	orchestratorv1.RegisterOrchestratorServiceServer(s, h)
}

// Si `contracts/` añade un RPC, esto deja de compilar en lugar de devolver
// `Unimplemented` en producción.
var _ orchestratorv1.OrchestratorServiceServer = (*Handler)(nil)

// ── sagas asíncronas ────────────────────────────────────────────────────────

// StartRegistration devuelve el handle en cuanto la saga queda registrada.
//
// La contraseña viaja en la petición, así que el interceptor de log de
// `middleware.go` no registra el mensaje. Aquí tampoco se guarda ni se transforma:
// se pasa a la saga, que la entrega a Auth, el único servicio que puede hashearla.
func (h *Handler) StartRegistration(ctx context.Context, req *orchestratorv1.StartRegistrationRequest) (*orchestratorv1.SagaHandle, error) {
	sagaID, err := h.svc.StartRegistration(ctx, req.GetEmail(), req.GetPassword(), req.GetDisplayName())
	if err != nil {
		return nil, grpcError(err)
	}
	return sagaHandleToProto(sagaID), nil
}

func (h *Handler) StartEmailVerification(ctx context.Context, req *orchestratorv1.EmailVerificationRequest) (*orchestratorv1.SagaHandle, error) {
	sagaID, err := h.svc.StartEmailVerification(ctx, req.GetUserId(), req.GetVerificationToken())
	if err != nil {
		return nil, grpcError(err)
	}
	return sagaHandleToProto(sagaID), nil
}

func (h *Handler) StartAccountAnonymization(ctx context.Context, req *orchestratorv1.UserRef) (*orchestratorv1.SagaHandle, error) {
	sagaID, err := h.svc.StartAccountAnonymization(ctx, req.GetUserId())
	if err != nil {
		return nil, grpcError(err)
	}
	return sagaHandleToProto(sagaID), nil
}

// ── sagas síncronas ─────────────────────────────────────────────────────────

func (h *Handler) StartQuizGrading(ctx context.Context, req *orchestratorv1.QuizGradingRequest) (*orchestratorv1.QuizGradingResult, error) {
	out, err := h.svc.StartQuizGrading(ctx, req.GetUserId(), req.GetQuizId(), req.GetAnswers())
	if err != nil {
		return nil, grpcError(err)
	}
	return quizGradingToProto(out), nil
}

// StartSimulation pasa el `CalcType` como el entero del enum.
//
// El enum lo posee el contrato del Simulador (`fintcart.simulator.v1.CalcType`) y se
// reutiliza aquí en lugar de un `int32` suelto: un entero sin tipo aceptaría
// cualquier número y el desajuste solo aparecería en ejecución. Este servicio no
// valida el valor —el dueño del enum lo rechaza si no lo conoce (Principio VI).
func (h *Handler) StartSimulation(ctx context.Context, req *orchestratorv1.SimulationRequest) (*orchestratorv1.SimulationResult, error) {
	out, err := h.svc.StartSimulation(ctx, req.GetUserId(), int32(req.GetCalcType()), req.GetCurrency(), req.GetInputs())
	if err != nil {
		return nil, grpcError(err)
	}
	return simulationToProto(out), nil
}

// ── consulta de estado ─────────────────────────────────────────────────────

func (h *Handler) GetSagaStatus(ctx context.Context, req *orchestratorv1.SagaHandle) (*orchestratorv1.SagaStatus, error) {
	out, err := h.svc.GetSagaStatus(ctx, req.GetSagaId())
	if err != nil {
		return nil, grpcError(err)
	}
	return sagaStatusToProto(out), nil
}
