package steps

import (
	"context"

	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Saga de REGISTRO (research D-04).
//
// Secuencia: crear la credencial → crear el perfil → publicar `user.registered`
// (que dispara el email de verificación en Notificación).
//
// El orden no es indiferente. La credencial va primero porque su `id` es el UUID
// que después usan el perfil y el claim `sub` del JWT: si el perfil fuera primero,
// habría que inventar el id aquí, y el Orquestador estaría generando identidad —una
// decisión de dominio que no le corresponde (Principio VI).
//
// La compensación del último paso es `nil` a propósito: publicar un evento no se
// deshace. Por eso el evento se emite al FINAL, cuando ya no queda nada que pueda
// fallar; emitirlo antes obligaría a enviar un «ignora el correo anterior».
func RegistrationDefinition(c Clients) Definition {
	return Definition{
		Type: storer.SagaRegistro,
		Steps: []Step{
			{
				Name: "auth.create_credential",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T092: `c.Auth.CreateCredential` con el correo, la contraseña y el
					// `user_id` generado por quien inicia la saga. Guarda `user_id` en
					// `st.Payload` para los pasos siguientes.
					_, _ = c, st
					return nil, ErrNotImplemented
				},
				Compensate: func(_ context.Context, _ *State) error {
					// T092: `RevokeAndAnonymizeCredential`. No se BORRA la credencial:
					// no existe un RPC de borrado, y con razón — el correo debe quedar
					// liberado sin que desaparezca el rastro de que hubo un intento.
					return ErrNotImplemented
				},
			},
			{
				Name: "users.create_profile",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T092: `c.Users.CreateProfile` con el `user_id` del paso anterior.
					// El RPC es idempotente, así que un reintento del paso no duplica.
					_ = st
					return nil, ErrNotImplemented
				},
				Compensate: func(_ context.Context, _ *State) error {
					// T092: `c.Users.AnonymizeProfile`.
					return ErrNotImplemented
				},
			},
			{
				Name: "emit.user_registered",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// El paso no publica: DEVUELVE el evento y el motor lo escribe en el
					// outbox dentro de la transacción del avance (D-07).
					_ = st
					return []Event{{
						Type:       events.EventUserRegistered,
						RoutingKey: events.EventUserRegistered,
						// T092 rellena el payload. Sin PII más allá del correo que
						// Notificación necesita para enviar el mensaje; el `actor_ref`
						// del sobre es un UUID opaco (FR-031).
						Payload: nil,
					}}, ErrNotImplemented
				},
				// Sin compensación: un evento publicado no se despublica.
				Compensate: nil,
			},
		},
	}
}
