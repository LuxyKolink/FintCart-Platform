package steps

import (
	"context"

	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Saga de ACTIVIDAD (FR-023, plan.md N-03).
//
// Secuencia: escribir la entrada en la bandeja in-app de Usuarios → publicar
// `user.activity` para que Notificación decida si además manda un correo.
//
// Existe por la aclaración N-03: la bandeja in-app la POSEE el Servicio de Usuarios,
// no Notificación. Notificación es consumidor puro sin superficie gRPC, así que no
// puede servir lecturas al usuario. La consecuencia es que alimentar la bandeja es
// una llamada gRPC (`Users.AppendInAppNotification`) y no un efecto secundario del
// consumo de un evento — y una llamada gRPC dentro de un flujo multi-servicio solo
// puede coordinarla una saga (Principio VI).
//
// NOTA SOBRE `plan.md`: el CHECK `saga_state_type_valid` admite `'actividad'` y N-03
// describe esta saga, pero la lista de archivos de `plan.md` §Source Code para
// `internal/server/steps/` enumera solo cinco y omite este. El esquema y N-03 son
// la fuente más específica, así que el archivo existe; la lista de `plan.md` está
// incompleta y conviene corregirla.
func ActivityDefinition(c Clients) Definition {
	return Definition{
		Type: storer.SagaActividad,
		Steps: []Step{
			{
				Name: "users.append_inapp_notification",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T118: `c.Users.AppendInAppNotification` con el tipo y el payload
					// JSON que trae la saga. El Orquestador no compone el mensaje: el
					// texto es una decisión de producto que pertenece a quien origina el
					// evento (Principio VI).
					_, _ = c, st
					return nil, ErrNotImplemented
				},
				Compensate: func(_ context.Context, _ *State) error {
					// T118: no hay RPC para retirar una entrada de la bandeja, y añadirlo
					// solo para compensar sería peor: una notificación que el usuario ya
					// pudo haber visto y desaparece es más confuso que una notificación de
					// más. Si el paso siguiente falla, se reintenta; el RPC debe ser
					// idempotente respecto al evento de origen para que reintentar no
					// duplique la entrada.
					return ErrNotImplemented
				},
			},
			{
				Name: "emit.user_activity",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					_ = st
					return []Event{{
						Type:       events.EventUserActivity,
						RoutingKey: events.EventUserActivity,
						Payload:    nil, // T118
					}}, ErrNotImplemented
				},
				Compensate: nil,
			},
		},
	}
}
