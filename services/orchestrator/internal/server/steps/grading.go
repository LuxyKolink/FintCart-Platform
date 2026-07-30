package steps

import (
	"context"

	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Saga de CALIFICACIÓN (research D-07, FR-012, FR-016, FR-027).
//
// Secuencia: calificar y persistir el intento en Aprendizaje → aplicar el puntaje
// al progreso en Usuarios → publicar `learning.quiz_graded` (Auditoría) y, si
// procede, `user.progress_milestone` (bandeja in-app).
//
// Esta saga es el caso de estudio de D-07, y merece la pena explicar por qué NO
// tiene compensaciones destructivas:
//
//   - El intento SIEMPRE se persiste, incluso si el usuario suspende (FR-016: el
//     historial es completo). Así que «deshacer» un intento sería falsificar el
//     historial, no compensar.
//   - `Users.ApplyQuizScore` es MONÓTONO: guarda el puntaje solo si supera el mejor
//     almacenado y recalcula los puntos. Repetirlo converge al mismo valor, así que
//     el reintento sustituye a la compensación.
//
// Ese diseño es lo que hace la saga segura frente a reintentos (FR-027) sin tener
// que restar puntos —una compensación que restara podría dejar al usuario por
// debajo de donde estaba si el mejor puntaje venía de otro intento anterior.
func GradingDefinition(c Clients) Definition {
	return Definition{
		Type: storer.SagaCalificacion,
		Steps: []Step{
			{
				Name: "learning.grade_and_store_attempt",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T095: `c.Learning.GradeAndStoreAttempt`. El `score` vuelve como
					// `string` decimal canónica y se guarda en `st.Payload` TAL CUAL,
					// sin convertirlo a número: el Orquestador transporta el valor, no
					// lo calcula (Principio VI + Principio VIII).
					_, _ = c, st
					return nil, ErrNotImplemented
				},
				// Sin compensación: el intento debe permanecer en el historial (FR-016).
				Compensate: nil,
			},
			{
				Name: "users.apply_quiz_score",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T095: `c.Users.ApplyQuizScore` con el `score` string del paso
					// anterior. Devuelve el progreso resultante, que va a `st.Payload`
					// para poder decidir si hay hito.
					_ = st
					return nil, ErrNotImplemented
				},
				// Sin compensación: la operación es monótona e idempotente (D-07).
				Compensate: nil,
			},
			{
				Name: "emit.quiz_graded_and_milestone",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T095 decide si además del evento de auditoría hay hito de
					// progreso. La condición del hito la fija Aprendizaje o Usuarios,
					// NO este paso: el Orquestador solo mira una bandera que ya viene en
					// el payload. Si evaluara aquí «¿superó el umbral?», el umbral
					// viviría en el Orquestador y sería lógica de dominio.
					_ = st
					return []Event{{
						Type:       events.EventLearningQuizGraded,
						RoutingKey: events.EventLearningQuizGraded,
						Payload:    nil, // T095; sin PII (solo lo consume Auditoría)
					}}, ErrNotImplemented
				},
				Compensate: nil,
			},
		},
	}
}
