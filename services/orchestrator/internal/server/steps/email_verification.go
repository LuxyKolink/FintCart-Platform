package steps

import (
	"context"
	"fmt"

	authv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/auth/v1"
	usersv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/users/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Saga de VERIFICACIÓN DE CORREO (FR-002).
//
// Secuencia: activar la credencial en Auth → marcar el correo verificado en
// Usuarios → publicar `user.email_verified` para Auditoría.
//
// Los dos primeros pasos son idempotentes por naturaleza —marcar como verificado
// algo ya verificado no cambia nada—, así que sus compensaciones son `nil`. Esa es
// la propiedad que hace esta saga la más simple de las cinco: un reintento total
// converge al mismo estado, de modo que no hace falta deshacer nada.
//
// El ORDEN lo decide dónde se comprueba el token. Auth va PRIMERO porque su paso es
// el que valida el token de verificación, y un paso que puede RECHAZAR la petición
// tiene que correr antes que cualquiera que modifique estado: al revés, una petición
// con un token equivocado dejaría el perfil marcado como verificado para siempre —y
// esa marca sería alcanzable por cualquiera que probase `user_id` al azar— mientras
// la credencial se queda pendiente.
//
// El precio es un instante en el que la credencial ya está `active` y el perfil
// todavía dice `email_verified = false`. Es benigno: la decisión de emitir tokens la
// toma Auth con su propio `login_status` (T091), y la bandera del perfil solo se
// muestra. La alternativa era una marca indeleble puesta por quien no probó nada.
//
// Deliberadamente NO se revierte la verificación si el último paso falla. Volver a
// dejar la cuenta como no verificada porque no se pudo escribir un evento de
// auditoría castigaría al usuario por un fallo de infraestructura; el evento sigue
// en el outbox y se reintenta.
func EmailVerificationDefinition(c Clients) Definition {
	return Definition{
		Type: storer.SagaVerificacionEmail,
		Steps: []Step{
			{
				Name: "auth.activate_credential",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					// El token viaja como SECRETO, no en el payload: persistirlo en
					// `saga_state` dejaría en la base lo que permite activar la cuenta.
					// Una saga reanudada no lo tiene y falla aquí, sin efecto que
					// deshacer; el usuario vuelve a pulsar el enlace, que sigue siendo
					// válido porque este paso nunca llegó a consumirlo.
					token, err := st.Secret(SecretVerificationToken)
					if err != nil {
						return nil, err
					}

					// El Orquestador NO comprueba el token: lo transporta. Compararlo
					// aquí sería una regla de dominio en el servicio que el Principio VI
					// deja sin dominio, y además exigiría que este servicio conociera el
					// hash — es decir, que pudiera activar cuentas por su cuenta.
					//
					// Mueve `pending_verification` → `active`, que es lo que levanta el
					// bloqueo de emisión de tokens de FR-002.
					if _, err := c.Auth.ActivateCredential(ctx, &authv1.ActivateCredentialRequest{
						UserId: userID, VerificationToken: token,
					}); err != nil {
						return nil, fmt.Errorf("activar la credencial de %s: %w", userID, err)
					}
					return nil, nil
				},
				Compensate: nil, // idempotente
			},
			{
				Name: "users.mark_email_verified",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					if _, err := c.Users.MarkEmailVerified(ctx, &usersv1.UserRef{UserId: userID}); err != nil {
						return nil, fmt.Errorf("marcar el correo de %s como verificado: %w", userID, err)
					}
					return nil, nil
				},
				Compensate: nil, // idempotente: no hay efecto que deshacer
			},
			{
				Name: "emit.user_email_verified",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					// Payload vacío: el único consumidor es Auditoría, y todo lo que
					// necesita —quién y cuándo— ya está en el sobre. Repetir el `user_id`
					// dentro sería un segundo sitio donde el mismo dato podría discrepar.
					return []Event{{
						Type:       events.EventUserEmailVerified,
						RoutingKey: events.EventUserEmailVerified,
						ActorRef:   userID,
					}}, nil
				},
				Compensate: nil,
			},
		},
	}
}
