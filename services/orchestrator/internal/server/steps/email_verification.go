package steps

import (
	"context"

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
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T094: `c.Users.MarkEmailVerified`. El token de verificación se
					// valida ANTES de iniciar la saga: comprobarlo aquí sería una regla
					// de dominio dentro del Orquestador (Principio VI).
					_, _ = c, st
					return nil, ErrNotImplemented
				},
				Compensate: nil, // idempotente: no hay efecto que deshacer
			},
			{
				Name: "auth.activate_credential",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T094: `c.Auth.ActivateCredential`, que mueve
					// `pending_verification` → `active`.
					_ = st
					return nil, ErrNotImplemented
				},
				Compensate: nil, // idempotente
			},
			{
				Name: "emit.user_email_verified",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					_ = st
					return []Event{{
						Type:       events.EventUserEmailVerified,
						RoutingKey: events.EventUserEmailVerified,
						Payload:    nil, // T094; solo consume Auditoría, así que sin PII
					}}, ErrNotImplemented
				},
				Compensate: nil,
			},
		},
	}
}
