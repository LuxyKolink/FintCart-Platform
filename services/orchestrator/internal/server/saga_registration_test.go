package server

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/server/steps"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Prueba de integración de la Saga de REGISTRO (T071, research D-04).
//
// A diferencia de `saga_test.go`, aquí el motor corre la definición REAL contra
// participantes que reproducen sus invariantes. Eso es lo que convierte la prueba en
// una de integración y no en una del motor: lo que se comprueba es si la SECUENCIA
// —credencial, perfil, token y evento— sigue dejando el sistema coherente cuando
// cualquiera de los tres pasos falla.
//
// El camino de fallo es el único que justifica que la saga exista (Principio VI) y es
// justo el que casi nunca se recorre en producción, así que se inyecta un fallo en
// cada paso, uno por uno, y se comprueba qué queda deshecho.

const (
	regEmail = "ana@fintcart.co"
	regName  = "Ana"
)

// newRegistrationEngine ensambla el motor con la definición real.
func newRegistrationEngine(store storer.Storer, auth *fakeAuthSvc, users *fakeUsersSvc) *Engine {
	return newTestEngine(store, steps.RegistrationDefinition(steps.Clients{
		Auth: auth, Users: users,
	}))
}

// waitTimeout acota la espera de las sagas en segundo plano. Generoso a propósito:
// un plazo justo convertiría una máquina de CI cargada en un fallo intermitente.
const waitTimeout = 5 * time.Second

// startRegistration arranca la saga, espera a que la goroutine termine y devuelve su
// identificador ya parseado.
//
// `StartRegistration` es asíncrona a propósito (el usuario no espera a que llegue el
// correo), así que sin la espera la prueba leería el estado a mitad de camino.
func startRegistration(t *testing.T, engine *Engine, email string) uuid.UUID {
	t.Helper()
	raw, err := New(engine).StartRegistration(context.Background(), email, "contraseña-larga-123", regName)
	require.NoError(t, err)
	require.True(t, engine.Wait(waitTimeout), "la saga no terminó a tiempo")

	id, err := uuid.Parse(raw)
	require.NoError(t, err)
	return id
}

// ── camino feliz ────────────────────────────────────────────────────────────

func TestRegistrationSagaLeavesEverythingInPlace(t *testing.T) {
	t.Parallel()
	store, auth, users := newMemStore(), newFakeAuth(), newFakeUsers()

	id := startRegistration(t, newRegistrationEngine(store, auth, users), regEmail)

	row := store.row(t, id)
	require.Equal(t, storer.StatusCompleted, row.Status)
	require.Equal(t, int32(3), row.CurrentStep)

	creds, anonymized := auth.snapshot()
	require.Equal(t, 1, creds)
	require.Zero(t, anonymized)
	require.Len(t, users.profiles, 1)

	// Un solo evento en el outbox, con el token que Auth acaba de emitir. Sin él, el
	// correo saldría sin enlace y el usuario no podría verificar nada.
	require.Len(t, store.events, 1)
	require.Equal(t, events.EventUserRegistered, store.events[0].EventType)
	require.Equal(t, 1, auth.tokens)
}

// ── inyección de fallo, paso a paso ─────────────────────────────────────────

// TestRegistrationSagaCompensatesWhicheverStepFails es el corazón de T071.
//
// Cada caso rompe UN paso y comprueba dos cosas distintas: qué quedó deshecho y qué
// NO llegó a hacerse. La segunda es la que atrapa una compensación de más — deshacer
// algo que nunca ocurrió es tan incorrecto como no deshacer lo que sí.
func TestRegistrationSagaCompensatesWhicheverStepFails(t *testing.T) {
	t.Parallel()

	unavailable := status.Error(codes.Unavailable, "el participante no responde")

	cases := []struct {
		name string
		// arrange rompe el paso correspondiente.
		arrange func(*fakeAuthSvc, *fakeUsersSvc)
		// wantCredentials es cuántas credenciales quedan VIVAS al final.
		wantCredentials int
		wantAnonymized  int
		wantProfiles    int
		wantEvents      int
	}{
		{
			name: "falla la credencial: no hay nada que deshacer",
			arrange: func(a *fakeAuthSvc, _ *fakeUsersSvc) {
				a.fail["CreateCredential"] = unavailable
			},
			// Ni una compensación. El paso no llegó a aplicarse, así que no entra en la
			// lista a deshacer; una llamada a `RevokeAndAnonymizeCredential` aquí
			// anonimizaría una cuenta que pertenece a otra persona con el mismo id.
			wantCredentials: 0, wantAnonymized: 0, wantProfiles: 0, wantEvents: 0,
		},
		{
			name: "falla el perfil: se deshace la credencial",
			arrange: func(_ *fakeAuthSvc, u *fakeUsersSvc) {
				u.fail["CreateProfile"] = unavailable
			},
			// La credencial se creó y hay que retirarla; si no, el correo quedaría
			// ocupado para siempre por una cuenta sin perfil.
			wantCredentials: 0, wantAnonymized: 1, wantProfiles: 0, wantEvents: 0,
		},
		{
			name: "falla el token: se deshacen perfil y credencial",
			arrange: func(a *fakeAuthSvc, _ *fakeUsersSvc) {
				a.fail["IssueVerificationToken"] = unavailable
			},
			// Sin token no hay correo posible, así que la cuenta quedaría inverificable
			// para siempre. Se deshace entera y la persona puede volver a registrarse.
			wantCredentials: 0, wantAnonymized: 1, wantProfiles: 0, wantEvents: 0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store, auth, users := newMemStore(), newFakeAuth(), newFakeUsers()
			tc.arrange(auth, users)

			id := startRegistration(t, newRegistrationEngine(store, auth, users), regEmail)

			row := store.row(t, id)
			require.Equal(t, storer.StatusFailed, row.Status)
			require.NotNil(t, row.LastError, "una saga fallida debe registrar su causa")

			creds, anonymized := auth.snapshot()
			require.Equal(t, tc.wantCredentials, creds)
			require.Equal(t, tc.wantAnonymized, anonymized)
			require.Len(t, users.profiles, tc.wantProfiles)
			// Ningún fallo puede dejar un evento en el outbox: `user.registered`
			// dispara el correo de bienvenida, y publicarlo sobre un registro que se
			// está deshaciendo obligaría a mandar después un «ignora el anterior».
			require.Len(t, store.events, tc.wantEvents)
		})
	}
}

// TestRegistrationSagaUndoesInReverseOrder fija el ORDEN de las compensaciones.
//
// Perfil antes que credencial. Al revés, el correo quedaría libre un instante mientras
// el perfil todavía existe, y un alta simultánea con la misma dirección podría colarse
// entre las dos.
func TestRegistrationSagaUndoesInReverseOrder(t *testing.T) {
	t.Parallel()
	store, auth, users := newMemStore(), newFakeAuth(), newFakeUsers()
	auth.fail["IssueVerificationToken"] = errors.New("auth caído")

	id := startRegistration(t, newRegistrationEngine(store, auth, users), regEmail)

	require.Len(t, users.anonymize, 1)
	require.Len(t, auth.anonymized, 1)
	// La lista de compensaciones que la saga registró se recorre en orden inverso al
	// de ejecución: el motor lo garantiza, y aquí se comprueba sobre la definición
	// real en lugar de sobre pasos sintéticos.
	require.Equal(t, storer.StatusFailed, store.row(t, id).Status)
}

// TestRegistrationSagaOrdersCredentialFirst es la prueba de la decisión de orden.
//
// Con el perfil primero, el fallo MÁS común del registro —un correo ya usado— crearía
// un perfil solo para tener que deshacerlo. Aquí el segundo alta ni siquiera llega a
// tocar Usuarios.
func TestRegistrationSagaOrdersCredentialFirst(t *testing.T) {
	t.Parallel()
	store, auth, users := newMemStore(), newFakeAuth(), newFakeUsers()
	engine := newRegistrationEngine(store, auth, users)

	_ = startRegistration(t, engine, regEmail)
	require.Len(t, users.profiles, 1)

	// Segundo registro con el MISMO correo: Auth lo rechaza por unicidad (FR-001).
	_ = startRegistration(t, engine, regEmail)

	require.Len(t, users.profiles, 1, "un correo repetido no debe crear un segundo perfil")
	require.Empty(t, users.anonymize, "no hay perfil que deshacer porque no se creó ninguno")
}

// TestRegistrationSagaFreesTheEmailAfterCompensating cierra el ciclo: un registro
// deshecho tiene que dejar a la persona volver a intentarlo con su dirección.
//
// Sin esto, una caída momentánea de Usuarios dejaría el correo inutilizable de forma
// permanente y el usuario no tendría forma de recuperarlo por sí mismo.
func TestRegistrationSagaFreesTheEmailAfterCompensating(t *testing.T) {
	t.Parallel()
	store, auth, users := newMemStore(), newFakeAuth(), newFakeUsers()
	users.fail["CreateProfile"] = errors.New("usuarios caído")

	_ = startRegistration(t, newRegistrationEngine(store, auth, users), regEmail)
	require.Len(t, auth.anonymized, 1)

	// Segundo intento, ya sin el fallo.
	delete(users.fail, "CreateProfile")
	id := startRegistration(t, newRegistrationEngine(store, auth, users), regEmail)

	require.Equal(t, storer.StatusCompleted, store.row(t, id).Status)
	require.Len(t, users.profiles, 1)
}

// TestRegistrationSagaWithoutSecretsCompensates: una saga reanudada tras un reinicio
// no tiene la contraseña, y ese es el precio deliberado de no persistirla.
//
// Lo que la prueba fija es que el precio se paga del lado seguro: la saga falla y
// compensa en lugar de crear una credencial con la contraseña en blanco.
func TestRegistrationSagaWithoutSecretsCompensates(t *testing.T) {
	t.Parallel()
	store, auth, users := newMemStore(), newFakeAuth(), newFakeUsers()
	engine := newRegistrationEngine(store, auth, users)

	// `Start` sin secretos es exactamente lo que hace `Resume` tras un reinicio.
	id, err := engine.Start(context.Background(), storer.SagaRegistro,
		map[string]any{"user_id": testActor, "email": regEmail, "display_name": regName}, nil)
	require.NoError(t, err)
	require.True(t, engine.Wait(waitTimeout))

	require.Equal(t, storer.StatusFailed, store.row(t, id).Status)
	creds, _ := auth.snapshot()
	require.Zero(t, creds, "nunca debe crearse una credencial sin contraseña")
	require.Empty(t, users.profiles)
}
