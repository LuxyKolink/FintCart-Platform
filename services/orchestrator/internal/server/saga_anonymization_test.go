package server

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/server/steps"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Prueba de integración de la Saga de ANONIMIZACIÓN (T130, research D-08, FR-030).
//
// Lo que distingue esta saga de las demás — y lo que hay que comprobar aquí y en
// ningún otro sitio — es que es DESTRUCTIVA e IRREVERSIBLE: no tiene compensaciones
// (D-08), así que la única forma de que quede a medias «de forma segura» es que
// cada paso sea idempotente y la saga esté diseñada para avanzar siempre. Y aun
// así, `audit_log` tiene que sobrevivir intacto con un `actor_ref` opaco: es lo que
// permite acreditar DESPUÉS que la anonimización ocurrió, sin volver a identificar
// a nadie.

const anonUser = "33333333-3333-4333-8333-333333333333"

func newAnonymizationEngine(
	store storer.Storer,
	auth *fakeAuthSvc,
	users *fakeUsersSvc,
	learning *fakeLearningSvc,
	sim *fakeSimulator,
) *Engine {
	return newTestEngine(store, steps.AnonymizationDefinition(steps.Clients{
		Auth: auth, Users: users, Learning: learning, Simulator: sim,
	}))
}

// startAnonymization arranca la saga (asíncrona, como el registro) y espera a que
// termine antes de inspeccionar el estado.
func startAnonymization(t *testing.T, engine *Engine, userID string) uuid.UUID {
	t.Helper()
	raw, err := New(engine).StartAccountAnonymization(context.Background(), userID)
	require.NoError(t, err)
	require.True(t, engine.Wait(waitTimeout), "la saga de anonimización no terminó a tiempo")

	id, err := uuid.Parse(raw)
	require.NoError(t, err)
	return id
}

// ── camino feliz ────────────────────────────────────────────────────────────

// TestAnonymizationSagaTouchesTheFourParticipants es el corazón de T130: los
// cuatro servicios con datos personales del titular quedan anonimizados, en el
// orden que fija la definición (Auth primero — ver el comentario de
// `steps.AnonymizationDefinition`).
func TestAnonymizationSagaTouchesTheFourParticipants(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	auth, users := newFakeAuth(), newFakeUsers()
	learning := newFakeLearning("0", false)
	sim := &fakeSimulator{}

	// El usuario existe en Auth y Usuarios antes de anonimizar, igual que en
	// producción: sin esto, la prueba no distinguiría «se anonimizó» de «nunca
	// hubo nada que anonimizar».
	auth.credentials[anonUser] = "ana@fintcart.co"
	auth.emails["ana@fintcart.co"] = anonUser
	users.profiles[anonUser] = "ana@fintcart.co"

	id := startAnonymization(t, newAnonymizationEngine(store, auth, users, learning, sim), anonUser)

	row := store.row(t, id)
	require.Equal(t, storer.StatusCompleted, row.Status)
	require.Equal(t, int32(5), row.CurrentStep)

	require.Contains(t, auth.anonymized, anonUser)
	require.Contains(t, users.anonymize, anonUser)
	require.Contains(t, learning.anonymized, anonUser)
	require.Contains(t, sim.anonymized, anonUser)

	// La credencial deja de ser resoluble por correo: la cuenta anonimizada no debe
	// poder volver a autenticarse ni liberar el correo para un login futuro con la
	// dirección real.
	_, stillCredentialed := auth.credentials[anonUser]
	require.False(t, stillCredentialed)
}

// TestAnonymizationSagaEmitsAccountAnonymizedWithOpaqueActorAndNoPII es la
// prueba de FR-031: el evento que deja constancia de la anonimización no puede
// él mismo filtrar el dato que se acaba de suprimir.
func TestAnonymizationSagaEmitsAccountAnonymizedWithOpaqueActorAndNoPII(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	auth, users := newFakeAuth(), newFakeUsers()
	learning := newFakeLearning("0", false)
	sim := &fakeSimulator{}

	auth.credentials[anonUser] = "ana@fintcart.co"
	auth.emails["ana@fintcart.co"] = anonUser
	users.profiles[anonUser] = "ana@fintcart.co"

	startAnonymization(t, newAnonymizationEngine(store, auth, users, learning, sim), anonUser)

	require.Len(t, store.events, 1)
	event := store.events[0]
	require.Equal(t, events.EventAccountAnonymized, event.EventType)

	// `Payload` de la fila del outbox es el SOBRE completo del catálogo
	// (`outboxRows` en `saga.go`), así que `actor_ref` viaja dentro de estos bytes.
	// Sigue siendo el UUID opaco del titular — es justo lo que sobrevive a la
	// anonimización para poder auditarla después.
	require.Contains(t, string(event.Payload), anonUser)
	// El correo real, en cambio, NO debe aparecer en ningún punto del sobre
	// serializado: un `audit_log` append-only no admite que se retire después.
	require.NotContains(t, string(event.Payload), "ana@fintcart.co")
}

// TestAnonymizationSagaHasNoCompensation fija por construcción la decisión de
// D-08: nada de lo que hace esta saga se puede deshacer, así que ningún paso
// declara una función de compensación.
func TestAnonymizationSagaHasNoCompensation(t *testing.T) {
	t.Parallel()
	def := steps.AnonymizationDefinition(steps.Clients{})

	require.Len(t, def.Steps, 5)
	for _, step := range def.Steps {
		require.Nil(t, step.Compensate, "el paso %q no debe compensar (D-08)", step.Name)
	}
}

// TestAnonymizationSagaAnonymizesAuthBeforeUsers comprueba el ORDEN, que es la
// parte que no es intercambiable de esta saga (ver la nota de
// `steps.AnonymizationDefinition`): anonimizar el perfil dejando la sesión viva
// abriría una ventana en la que un token todavía válido opera en nombre de
// alguien que formalmente ya no existe.
func TestAnonymizationSagaAnonymizesAuthBeforeUsers(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	auth, users := newFakeAuth(), newFakeUsers()
	learning := newFakeLearning("0", false)
	sim := &fakeSimulator{}

	auth.credentials[anonUser] = "ana@fintcart.co"
	users.profiles[anonUser] = "ana@fintcart.co"

	startAnonymization(t, newAnonymizationEngine(store, auth, users, learning, sim), anonUser)

	def := steps.AnonymizationDefinition(steps.Clients{})
	require.Equal(t, "auth.revoke_and_anonymize_credential", def.Steps[0].Name)
	require.Equal(t, "users.anonymize_profile", def.Steps[1].Name)
}
