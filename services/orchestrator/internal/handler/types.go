// Tipos y contratos de la capa de TRANSPORTE del Orquestador (Principio IX).
package handler

import (
	"context"

	"github.com/fintcart/platform/services/orchestrator/internal/server"
)

// Service es lo que el transporte necesita de la capa de aplicación.
//
// Declarada en el consumidor, con tipos de dominio (`server.QuizGrading`,
// `server.SagaStatus`) y nunca proto.
//
// Nótese la asimetría de los valores de retorno: tres métodos devuelven un `string`
// —el handle de la saga— y dos devuelven datos. No es una inconsistencia: los flujos
// de registro, verificación y anonimización son asíncronos y el cliente los consulta
// después; los de calificación y simulación son síncronos porque alguien está
// esperando el resultado en pantalla.
type Service interface {
	StartRegistration(ctx context.Context, email, password, displayName string) (string, error)
	StartEmailVerification(ctx context.Context, userID, verificationToken string) (string, error)
	StartAccountAnonymization(ctx context.Context, userID string) (string, error)
	StartQuizGrading(ctx context.Context, userID, quizID string, answers map[string]string) (server.QuizGrading, error)
	StartSimulation(ctx context.Context, userID string, calcType int32, currency string, inputs map[string]string) (server.Simulation, error)
	GetSagaStatus(ctx context.Context, sagaID string) (server.SagaStatus, error)
}
