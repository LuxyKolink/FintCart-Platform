package server

import (
	"context"
)

// Reporte estadístico de actividad (FR-018).
//
// Este archivo es donde plan.md N-02 se vuelve código. `ActivityReport` mezcla
// tres dominios:
//
//	articles_viewed   → propio (tabla `article_views` de users_db)
//	quizzes_attempted → de Aprendizaje
//	simulations_run   → del Simulador
//
// Los dos últimos se obtienen por gRPC SALIENTE y queda PROHIBIDO leerlos de las
// bases de esos servicios (Principio III). No es una preferencia arquitectónica:
// un `SELECT` contra learning_db congelaría el esquema de Aprendizaje como si
// fuera una API pública, y cualquier migración suya rompería este servicio en
// silencio, sin que ninguna prueba de contrato lo detectara.

// AttemptCounter cuenta intentos de cuestionario de un usuario.
//
// Es un puerto ESTRECHO y no el cliente gRPC completo de Aprendizaje, y eso es
// deliberado: `GetActivityReport` necesita exactamente un número, así que el tipo
// declara solo eso. El beneficio es doble — el doble de prueba es de tres líneas
// (N-02 exige que US3 se pueda probar de forma independiente), y esta capa no
// adquiere acceso al resto de la API de Aprendizaje solo porque necesitaba un
// contador.
type AttemptCounter interface {
	CountAttempts(ctx context.Context, userID string) (int64, error)
}

// SimulationCounter cuenta simulaciones ejecutadas por un usuario.
type SimulationCounter interface {
	CountSimulations(ctx context.Context, userID string) (int64, error)
}

// ActivityReport es la vista de dominio del reporte (FR-018).
type ActivityReport struct {
	UserID           string
	Points           int32
	ArticlesViewed   int64
	QuizzesAttempted int64
	SimulationsRun   int64
}

// GetActivityReport agrega el dato propio con los dos remotos.
func (s *Server) GetActivityReport(_ context.Context, userID string) (ActivityReport, error) {
	if _, err := parseUserID(userID); err != nil {
		return ActivityReport{}, err
	}
	// T160 implementa:
	//   1. `store.GetProgress` y `store.CountArticleViews` (datos propios).
	//   2. `attempts.CountAttempts` y `sims.CountSimulations` en paralelo, con el
	//      contexto propagado para que un servicio lento no bloquee el reporte
	//      completo más allá del deadline del llamador.
	//   3. Decidir qué hacer si un servicio remoto no responde. Es una decisión de
	//      dominio, no de transporte: un reporte con un contador ausente puede ser
	//      preferible a ningún reporte, pero no puede presentarse como si el
	//      contador fuera cero.
	return ActivityReport{}, ErrNotImplemented
}
