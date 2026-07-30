package steps

import (
	"context"

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
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T162: `c.Auth.RevokeAndAnonymizeCredential`.
					_, _ = c, st
					return nil, ErrNotImplemented
				},
				Compensate: nil, // irreversible por diseño: ver la nota de la saga
			},
			{
				Name: "users.anonymize_profile",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T162: `c.Users.AnonymizeProfile`. Conserva el progreso y los
					// agregados: FR-030 exige suprimir los datos personales, no el
					// historial de aprendizaje, que ya no identifica a nadie.
					_ = st
					return nil, ErrNotImplemented
				},
				Compensate: nil,
			},
			{
				Name: "learning.anonymize_attempts",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T162: `c.Learning.AnonymizeAttempts`.
					_ = st
					return nil, ErrNotImplemented
				},
				Compensate: nil,
			},
			{
				Name: "simulator.anonymize_history",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T162: `c.Simulator.AnonymizeHistory`.
					_ = st
					return nil, ErrNotImplemented
				},
				Compensate: nil,
			},
			{
				Name: "emit.account_anonymized",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					_ = st
					return []Event{{
						Type:       events.EventAccountAnonymized,
						RoutingKey: events.EventAccountAnonymized,
						// T162: SOLO el `actor_ref` opaco y la marca temporal. Meter aquí
						// el correo que se acaba de borrar reintroduciría en un log
						// append-only justo el dato que la saga existe para eliminar.
						Payload: nil,
					}}, ErrNotImplemented
				},
				Compensate: nil,
			},
		},
	}
}
