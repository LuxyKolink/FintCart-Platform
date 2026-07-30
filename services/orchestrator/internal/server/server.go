// Capa de aplicación del Orquestador (Principio IX).
//
// «Aplicación» aquí significa MENOS de lo habitual, y a propósito: el Principio VI
// prohíbe lógica de dominio en este servicio. Lo que hay es la traducción de cada
// RPC a un arranque de saga y la consulta de estado. Ninguna regla de negocio —qué
// puntaje aprueba, cuánto vale una cuota, qué campos son obligatorios— vive aquí; si
// alguna aparece, pertenece al servicio dueño de ese dominio.
package server

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Errores de dominio de esta capa.
var (
	ErrInvalidArgument = errors.New("server: argumento inválido")
	// ErrNotImplemented marca lo que llega con T060 y las tareas por historia.
	ErrNotImplemented = errors.New("server: no implementado")
)

// Centinelas de persistencia que forman parte del contrato de esta capa, para que
// `handler` no importe `storer`. Alias, para que `errors.Is` recorra la cadena `%w`.
var (
	ErrNotFound = storer.ErrNotFound
	ErrConflict = storer.ErrConflict
)

// Server traduce los RPC de `OrchestratorService` en arranques de saga.
//
// Su única dependencia es el motor. No tiene clientes gRPC propios: los tienen los
// pasos, inyectados en sus definiciones. Esa separación es la que impide que un RPC
// «se salte» la saga y llame directamente a un servicio, que es la forma más fácil
// de perder la garantía de compensación.
type Server struct {
	engine *Engine
}

// New ensambla la capa de aplicación.
func New(engine *Engine) *Server {
	return &Server{engine: engine}
}

// parseSagaID valida el handle antes de que llegue al SQL.
func parseSagaID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%w: saga_id %q no es un UUID", ErrInvalidArgument, raw)
	}
	return id, nil
}

// ── sagas asíncronas: devuelven un handle ───────────────────────────────────

// StartRegistration arranca la saga de registro (D-04).
func (s *Server) StartRegistration(ctx context.Context, email, password, displayName string) (string, error) {
	if email == "" || password == "" {
		return "", fmt.Errorf("%w: email y password son obligatorios", ErrInvalidArgument)
	}
	// Solo se comprueba la PRESENCIA de los campos, no su forma: validar el formato
	// del correo o la fuerza de la contraseña aquí duplicaría reglas que ya viven en
	// Auth, y dos validaciones de la misma regla acaban discrepando (Principio VI).
	id, err := s.engine.Start(ctx, storer.SagaRegistro, map[string]any{
		"email":        email,
		"password":     password,
		"display_name": displayName,
	})
	if err != nil {
		return "", fmt.Errorf("arrancar saga de registro: %w", err)
	}
	return id.String(), nil
}

// StartEmailVerification arranca la saga de verificación de correo (FR-002).
func (s *Server) StartEmailVerification(ctx context.Context, userID, verificationToken string) (string, error) {
	if userID == "" || verificationToken == "" {
		return "", fmt.Errorf("%w: user_id y verification_token son obligatorios", ErrInvalidArgument)
	}
	id, err := s.engine.Start(ctx, storer.SagaVerificacionEmail, map[string]any{
		"user_id":            userID,
		"verification_token": verificationToken,
	})
	if err != nil {
		return "", fmt.Errorf("arrancar saga de verificación de correo: %w", err)
	}
	return id.String(), nil
}

// StartAccountAnonymization arranca la saga de anonimización (FR-030, D-08).
func (s *Server) StartAccountAnonymization(ctx context.Context, userID string) (string, error) {
	if userID == "" {
		return "", fmt.Errorf("%w: user_id es obligatorio", ErrInvalidArgument)
	}
	id, err := s.engine.Start(ctx, storer.SagaAnonimizacion, map[string]any{"user_id": userID})
	if err != nil {
		return "", fmt.Errorf("arrancar saga de anonimización: %w", err)
	}
	return id.String(), nil
}

// ── sagas síncronas: devuelven el resultado ────────────────────────────────

// QuizGrading es el resultado de la saga de calificación.
//
// `Score` es una `string` decimal canónica y NO un número: el Orquestador la recibe
// de Aprendizaje y la reenvía sin tocarla (Principio VIII / D-10). Convertirla a
// `float64` aquí para «pasarla» perdería centésimas de una calificación en un
// servicio que no tiene ninguna razón para interpretarla.
type QuizGrading struct {
	AttemptID   string
	AttemptNo   int32
	Score       string
	Passed      bool
	PointsAfter int32
}

// StartQuizGrading ejecuta la saga de calificación y espera su resultado (D-07).
//
// Es síncrona porque el usuario está esperando su nota: devolver un handle y obligar
// al Gateway a sondear convertiría una interacción inmediata en un bucle de espera.
func (s *Server) StartQuizGrading(_ context.Context, userID, quizID string, answers map[string]string) (QuizGrading, error) {
	if userID == "" || quizID == "" {
		return QuizGrading{}, fmt.Errorf("%w: user_id y quiz_id son obligatorios", ErrInvalidArgument)
	}
	// T095: arrancar `SagaCalificacion` y extraer del payload final el `attempt_id`,
	// el `score` (string), `passed` y `points_after`.
	_ = answers
	return QuizGrading{}, ErrNotImplemented
}

// Simulation es el resultado de una simulación mediada.
//
// `Result` es un mapa de strings decimales, igual que las entradas: los montos no se
// convierten en ningún punto de este servicio (Principio VIII).
type Simulation struct {
	SimulationID string
	Result       map[string]string
}

// StartSimulation ejecuta la simulación mediada y espera su resultado (D-03).
func (s *Server) StartSimulation(_ context.Context, userID string, calcType int32, currency string, inputs map[string]string) (Simulation, error) {
	if userID == "" {
		return Simulation{}, fmt.Errorf("%w: user_id es obligatorio", ErrInvalidArgument)
	}
	// T129: arrancar `SagaSimulacion`. `calcType` viaja como el entero del enum del
	// contrato del Simulador; el Orquestador no lo interpreta ni comprueba que sea un
	// valor conocido — el dueño del enum es el Simulador y él lo rechaza si no lo es.
	_, _ = calcType, currency
	_ = inputs
	return Simulation{}, ErrNotImplemented
}

// ── consulta de estado ─────────────────────────────────────────────────────

// GetSagaStatus consulta el estado de una saga por su handle.
func (s *Server) GetSagaStatus(ctx context.Context, sagaID string) (SagaStatus, error) {
	id, err := parseSagaID(sagaID)
	if err != nil {
		return SagaStatus{}, err
	}
	return s.engine.Status(ctx, id)
}
