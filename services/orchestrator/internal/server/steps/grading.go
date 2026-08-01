package steps

import (
	"context"
	"encoding/json"
	"fmt"

	learningv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/learning/v1"
	usersv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/users/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Tipos de notificación in-app, replicados del CHECK de `inapp_notifications` y de
// la validación de `users.internal/server/inapp.go`.
//
// Un tipo mal escrito NO es un fallo silencioso —Usuarios lo rechaza como argumento
// inválido—, pero sí sería un fallo TARDÍO: aparecería en ejecución, dentro de una
// saga, tras haber calificado el intento. Como constantes, el error es de compilación.
const (
	NotifQuizResult        = "resultado_cuestionario"
	NotifProgressMilestone = "hito_progreso"
)

// Saga de CALIFICACIÓN (research D-07, FR-012, FR-016, FR-027).
//
// Secuencia: calificar y persistir el intento en Aprendizaje → aplicar el puntaje
// al progreso en Usuarios → escribir la bandeja in-app → publicar
// `learning.quiz_graded` (Auditoría) y, si procede, `user.progress_milestone`.
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
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					quizID, err := st.String(payloadQuizID)
					if err != nil {
						return nil, err
					}
					answers, err := st.StringMap(payloadAnswers)
					if err != nil {
						return nil, err
					}

					resp, err := c.Learning.GradeAndStoreAttempt(ctx, &learningv1.GradeRequest{
						UserId: userID, QuizId: quizID, Answers: answers,
					})
					if err != nil {
						return nil, fmt.Errorf("calificar el cuestionario %s de %s: %w", quizID, userID, err)
					}

					// El `score` se guarda TAL CUAL, como la `string` decimal que
					// devuelve Aprendizaje: convertirlo a número aquí perdería centésimas
					// de una calificación en un servicio que no tiene ninguna razón para
					// interpretarla (Principio VIII / D-10).
					st.Payload[payloadAttemptID] = resp.GetAttemptId()
					st.Payload[payloadAttemptNo] = resp.GetAttemptNo()
					st.Payload[payloadScore] = resp.GetScore()
					// `passed` lo decide APRENDIZAJE con su `pass_threshold`. El
					// Orquestador lo transporta y lo usa como bandera, pero no lo calcula:
					// en el momento en que comparara el puntaje con un umbral, el umbral
					// viviría aquí y sería lógica de dominio (Principio VI).
					st.Payload[payloadPassed] = resp.GetPassed()
					return nil, nil
				},
				// Sin compensación: el intento debe permanecer en el historial (FR-016).
				Compensate: nil,
			},
			{
				Name: "users.apply_quiz_score",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					quizID, err := st.String(payloadQuizID)
					if err != nil {
						return nil, err
					}
					score, err := st.String(payloadScore)
					if err != nil {
						return nil, err
					}

					progress, err := c.Users.ApplyQuizScore(ctx, &usersv1.ApplyQuizScoreRequest{
						UserId: userID, QuizId: quizID, Score: score,
					})
					if err != nil {
						return nil, fmt.Errorf("aplicar el puntaje de %s al progreso de %s: %w",
							quizID, userID, err)
					}
					st.Payload[payloadPointsAfter] = progress.GetPoints()
					return nil, nil
				},
				// Sin compensación: la operación es monótona e idempotente (D-07).
				Compensate: nil,
			},
			{
				Name: "users.append_inapp_result",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					quizID, err := st.String(payloadQuizID)
					if err != nil {
						return nil, err
					}
					score, err := st.String(payloadScore)
					if err != nil {
						return nil, err
					}
					attemptID, err := st.String(payloadAttemptID)
					if err != nil {
						return nil, err
					}
					passed, _ := st.Payload[payloadPassed].(bool)

					// El resultado SIEMPRE va a la bandeja: es lo que el usuario está
					// esperando ver (FR-023). El `score` viaja como cadena decimal también
					// aquí — un número JSON lo redondearía en el navegador.
					if err := appendInApp(ctx, c, userID, st.SagaID, NotifQuizResult, map[string]any{
						"quiz_id":    quizID,
						"attempt_id": attemptID,
						"score":      score,
						"passed":     passed,
					}); err != nil {
						return nil, err
					}

					if !passed {
						return nil, nil
					}
					// El hito solo se anota si Aprendizaje dijo que aprobó. Los puntos van
					// como número porque son enteros por definición y no dinero.
					return nil, appendInApp(ctx, c, userID, st.SagaID, NotifProgressMilestone, map[string]any{
						"quiz_id": quizID,
						"points":  st.Payload[payloadPointsAfter],
					})
				},
				// Sin compensación: no hay RPC para retirar una entrada de la bandeja, y
				// añadirlo solo para compensar sería peor — una notificación que el usuario
				// ya pudo haber visto y desaparece es más confuso que una de más. El
				// reintento no duplica: la identidad de la entrada es (saga_id, tipo).
				Compensate: nil,
			},
			{
				Name: "emit.quiz_graded_and_milestone",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					quizID, err := st.String(payloadQuizID)
					if err != nil {
						return nil, err
					}
					score, err := st.String(payloadScore)
					if err != nil {
						return nil, err
					}
					attemptID, err := st.String(payloadAttemptID)
					if err != nil {
						return nil, err
					}
					passed, _ := st.Payload[payloadPassed].(bool)

					// Sin datos personales: el único consumidor es Auditoría y el titular
					// viaja como `actor_ref` opaco (FR-031).
					produced := []Event{{
						Type:       events.EventLearningQuizGraded,
						RoutingKey: events.EventLearningQuizGraded,
						ActorRef:   userID,
						Payload: map[string]any{
							"quiz_id":    quizID,
							"attempt_id": attemptID,
							"score":      score,
							"passed":     passed,
						},
					}}
					if !passed {
						return produced, nil
					}
					return append(produced, Event{
						Type:       events.EventUserProgressMilestone,
						RoutingKey: events.EventUserProgressMilestone,
						ActorRef:   userID,
						Payload: map[string]any{
							"quiz_id": quizID,
							"points":  st.Payload[payloadPointsAfter],
						},
					}), nil
				},
				Compensate: nil,
			},
		},
	}
}

// appendInApp escribe una entrada en la bandeja de Usuarios.
//
// El `event_id` que se envía es el `saga_id`, y esa elección es la que hace el paso
// reintentable. Es lo ÚNICO estable entre reintentos: el `event_id` del outbox se
// genera de nuevo cada vez que un paso devuelve sus eventos, así que usarlo aquí
// haría que un reintento produjera una segunda entrada indistinguible en la bandeja
// del usuario. Como Usuarios identifica la entrada por el par (`event_id`, `type`),
// las dos notificaciones de esta saga conviven sin pisarse.
func appendInApp(
	ctx context.Context,
	c Clients,
	userID, sagaID, notifType string,
	payload map[string]any,
) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("serializar la notificación %q de %s: %w", notifType, userID, err)
	}
	return appendInAppRaw(ctx, c, userID, sagaID, notifType, string(body))
}

// appendInAppRaw es la variante con el payload ya serializado, para los flujos que
// lo reciben como texto desde fuera (la saga de actividad).
func appendInAppRaw(
	ctx context.Context,
	c Clients,
	userID, sagaID, notifType, body string,
) error {
	if _, err := c.Users.AppendInAppNotification(ctx, &usersv1.InAppNotification{
		UserId:      userID,
		Type:        notifType,
		PayloadJson: body,
		EventId:     sagaID,
	}); err != nil {
		return fmt.Errorf("añadir la notificación %q a la bandeja de %s: %w", notifType, userID, err)
	}
	return nil
}
