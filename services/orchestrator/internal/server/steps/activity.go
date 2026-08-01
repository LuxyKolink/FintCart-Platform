package steps

import (
	"context"

	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Saga de ACTIVIDAD (FR-023, plan.md N-03).
//
// Secuencia: escribir la entrada en la bandeja in-app de Usuarios → publicar
// `user.activity` para Auditoría.
//
// Existe por la aclaración N-03: la bandeja in-app la POSEE el Servicio de Usuarios,
// no Notificación. Notificación es consumidor puro sin superficie gRPC, así que no
// puede servir lecturas al usuario. La consecuencia es que alimentar la bandeja es
// una llamada gRPC (`Users.AppendInAppNotification`) y no un efecto secundario del
// consumo de un evento — y una llamada gRPC dentro de un flujo multi-servicio solo
// puede coordinarla una saga (Principio VI).
//
// El Orquestador NO compone el mensaje: el tipo y el payload llegan tal cual desde
// quien arranca la saga. Decidir qué dice una notificación es una decisión de
// producto que pertenece a quien origina el evento; aquí solo se transporta.
//
// HUECO DE CONTRATO ANOTADO: `orchestrator.proto` no tiene ningún RPC que arranque
// esta saga. Los otros cinco flujos sí lo tienen (`StartRegistration`,
// `StartEmailVerification`, `StartQuizGrading`, `StartSimulation`,
// `StartAccountAnonymization`). La definición existe y es alcanzable desde
// `server.StartActivity`, pero hoy solo en proceso: la actividad que sí tiene ruta
// —el resultado de un cuestionario— la escribe la propia saga de calificación, y el
// registro de vista de artículo lo enruta el Gateway directamente a
// `Users.RecordArticleView` (research §D-06). Añadir el RPC exige decidir además su
// ruta REST, que pertenece a las tareas del borde.
func ActivityDefinition(c Clients) Definition {
	return Definition{
		Type: storer.SagaActividad,
		Steps: []Step{
			{
				Name: "users.append_inapp_notification",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					notifType, err := st.String(payloadNotifType)
					if err != nil {
						return nil, err
					}
					body, err := st.String(payloadNotifBody)
					if err != nil {
						return nil, err
					}

					// Se reutiliza el mismo ayudante que la saga de calificación para que
					// la clave de idempotencia se derive igual en los dos sitios. El
					// payload llega ya serializado, así que se pasa envuelto y `appendInApp`
					// lo vuelve a serializar; el coste es una pasada de JSON y a cambio no
					// hay dos formas distintas de escribir en la bandeja.
					return nil, appendInAppRaw(ctx, c, userID, st.SagaID, notifType, body)
				},
				// Sin compensación: no hay RPC para retirar una entrada de la bandeja, y
				// añadirlo solo para compensar sería peor — una notificación que el usuario
				// ya pudo haber visto y desaparece es más confuso que una de más. Si el
				// paso siguiente falla, se reintenta, y la identidad (saga_id, tipo) hace
				// que el reintento no duplique.
				Compensate: nil,
			},
			{
				Name: "emit.user_activity",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					notifType, err := st.String(payloadNotifType)
					if err != nil {
						return nil, err
					}
					// Solo el TIPO de actividad, no su contenido: el payload de la
					// notificación es texto para el usuario y puede llevar datos personales,
					// mientras que este evento va a Auditoría, donde el catálogo los
					// prohíbe.
					return []Event{{
						Type:       events.EventUserActivity,
						RoutingKey: events.EventUserActivity,
						ActorRef:   userID,
						Payload:    map[string]any{"activity_type": notifType},
					}}, nil
				},
				Compensate: nil,
			},
		},
	}
}
