package steps

import (
	"context"
	"fmt"

	authv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/auth/v1"
	learningv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/learning/v1"
	simulatorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/simulator/v1"
	usersv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/users/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Saga de ANONIMIZACIÓN de cuenta (FR-030, research D-08).
//
// Secuencia: Auth (revocar sesiones + anonimizar credencial) → Usuarios → Aprendizaje
// → Simulador → publicar `account.anonymized` para Auditoría.
//
// Dos propiedades separan esta saga de las demás, y las dos son consecuencia de que
// destruye datos:
//
//  1. **Auth va primero.** Anonimizar el perfil dejando la sesión viva abriría una
//     ventana en la que un token todavía válido opera en nombre de alguien que
//     formalmente ya no existe.
//  2. **NINGÚN paso tiene compensación, y no es un olvido.** No se puede
//     «des-anonimizar»: el dato personal ya no está. Por eso todos los pasos son
//     idempotentes y la saga está diseñada para AVANZAR SIEMPRE — si un paso falla,
//     se reintenta hasta completarse, nunca se revierte. Una saga con pasos
//     irreversibles solo es segura si el reintento es seguro, y aquí lo es.
//
// Auditoría NO se anonimiza: conserva el registro con `actor_ref` opaco
// (FR-031). Es la excepción explícita de D-08, y es lo que permite acreditar que la
// anonimización ocurrió sin volver a identificar a nadie.
func AnonymizationDefinition(c Clients) Definition {
	return Definition{
		Type: storer.SagaAnonimizacion,
		Steps: []Step{
			{
				Name: "auth.revoke_and_anonymize_credential",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					if _, err := c.Auth.RevokeAndAnonymizeCredential(ctx, &authv1.UserRef{UserId: userID}); err != nil {
						return nil, fmt.Errorf("revocar y anonimizar la credencial de %s: %w", userID, err)
					}
					return nil, nil
				},
				Compensate: nil, // irreversible por diseño: ver la nota de la saga
			},
			{
				Name: "users.anonymize_profile",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					// Conserva el progreso y los agregados: FR-030 exige suprimir los
					// datos personales, no el historial de aprendizaje, que ya no
					// identifica a nadie.
					if _, err := c.Users.AnonymizeProfile(ctx, &usersv1.UserRef{UserId: userID}); err != nil {
						return nil, fmt.Errorf("anonimizar el perfil de %s: %w", userID, err)
					}
					return nil, nil
				},
				Compensate: nil,
			},
			{
				Name: "learning.anonymize_attempts",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					if _, err := c.Learning.AnonymizeAttempts(ctx, &learningv1.UserRef{UserId: userID}); err != nil {
						return nil, fmt.Errorf("anonimizar los intentos de %s: %w", userID, err)
					}
					return nil, nil
				},
				Compensate: nil,
			},
			{
				Name: "simulator.anonymize_history",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					if _, err := c.Simulator.AnonymizeHistory(ctx, &simulatorv1.UserRef{UserId: userID}); err != nil {
						return nil, fmt.Errorf("anonimizar el historial de simulaciones de %s: %w", userID, err)
					}
					return nil, nil
				},
				Compensate: nil,
			},
			{
				Name: "emit.account_anonymized",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					return []Event{{
						Type:       events.EventAccountAnonymized,
						RoutingKey: events.EventAccountAnonymized,
						ActorRef:   userID,
						// SOLO el `actor_ref` opaco. Meter aquí el correo que se acaba de
						// borrar reintroduciría en un log append-only justo el dato que la
						// saga existe para eliminar; la marca temporal ya la pone el
						// publicador en `occurred_at` del sobre.
						Payload: nil,
					}}, nil
				},
				Compensate: nil,
			},
		},
	}
}
