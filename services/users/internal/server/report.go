package server

import (
	"context"
	"fmt"
	"sync"
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
//
// Los cuatro conteos se piden en paralelo con el MISMO contexto: si el llamador
// tiene un plazo, un participante remoto lento no debe consumirlo entero antes de
// que los demás siquiera empiecen. Un fallo en cualquiera de los cuatro hace
// fallar el reporte COMPLETO en lugar de sustituir el contador ausente por cero:
// un reporte que dijera «cero simulaciones» cuando en realidad el Simulador no
// respondió sería un dato falso, y en un reporte de actividad eso es peor que no
// tener reporte.
func (s *Server) GetActivityReport(ctx context.Context, userID string) (ActivityReport, error) {
	id, err := parseUserID(userID)
	if err != nil {
		return ActivityReport{}, err
	}

	var (
		wg                                     sync.WaitGroup
		points                                 int32
		articlesViewed, attempted, simulations int64
		errs                                   [4]error
	)

	wg.Add(4)
	go func() {
		defer wg.Done()
		progress, err := s.store.GetProgress(ctx, id)
		if err != nil {
			errs[0] = fmt.Errorf("leer progreso: %w", err)
			return
		}
		points = progress.Points
	}()
	go func() {
		defer wg.Done()
		n, err := s.store.CountArticleViews(ctx, id)
		if err != nil {
			errs[1] = fmt.Errorf("contar artículos vistos: %w", err)
			return
		}
		articlesViewed = n
	}()
	go func() {
		defer wg.Done()
		n, err := s.attempts.CountAttempts(ctx, userID)
		if err != nil {
			errs[2] = fmt.Errorf("contar intentos de cuestionario: %w", err)
			return
		}
		attempted = n
	}()
	go func() {
		defer wg.Done()
		n, err := s.sims.CountSimulations(ctx, userID)
		if err != nil {
			errs[3] = fmt.Errorf("contar simulaciones: %w", err)
			return
		}
		simulations = n
	}()
	wg.Wait()

	for _, err := range errs {
		if err != nil {
			return ActivityReport{}, fmt.Errorf("obtener reporte de actividad: %w", err)
		}
	}

	return ActivityReport{
		UserID:           userID,
		Points:           points,
		ArticlesViewed:   articlesViewed,
		QuizzesAttempted: attempted,
		SimulationsRun:   simulations,
	}, nil
}
