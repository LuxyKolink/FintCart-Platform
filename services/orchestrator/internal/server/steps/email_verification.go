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
// Secuencia: marcar el correo verificado en Usuarios → activar la credencial en
// Auth → publicar `user.email_verified` para Auditoría.
//
// Los dos primeros pasos son idempotentes por naturaleza —marcar como verificado
// algo ya verificado no cambia nada—, así que sus compensaciones son `nil`. Esa es
// la propiedad que hace esta saga la más simple de las cinco: un reintento total
// converge al mismo estado, de modo que no hace falta deshacer nada.
//
// El ORDEN sí importa, y no por idempotencia: Auth va SEGUNDO porque es el paso que
// desbloquea la emisión de tokens (T091). Al revés, entre activar la credencial y
// marcar el perfil habría un instante con sesión plena sobre un perfil que aún se
// declara sin verificar, y cualquier lectura en ese hueco vería los dos servicios
// contradiciéndose.
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
				Name: "users.mark_email_verified",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					// El token de verificación se valida ANTES de iniciar la saga:
					// comprobarlo aquí sería una regla de dominio dentro del Orquestador
					// (Principio VI). Por eso no se lee en ningún paso.
					if _, err := c.Users.MarkEmailVerified(ctx, &usersv1.UserRef{UserId: userID}); err != nil {
						return nil, fmt.Errorf("marcar el correo de %s como verificado: %w", userID, err)
					}
					return nil, nil
				},
				Compensate: nil, // idempotente: no hay efecto que deshacer
			},
			{
				Name: "auth.activate_credential",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					// Mueve `pending_verification` → `active`, que es lo que levanta el
					// bloqueo de emisión de tokens de FR-002.
					if _, err := c.Auth.ActivateCredential(ctx, &authv1.UserRef{UserId: userID}); err != nil {
						return nil, fmt.Errorf("activar la credencial de %s: %w", userID, err)
					}
					return nil, nil
				},
				Compensate: nil, // idempotente
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
