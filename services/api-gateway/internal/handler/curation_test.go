package handler_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
	"github.com/fintcart/platform/services/api-gateway/internal/handler"
)

// Pruebas de la curaduría de calculadoras en el borde (T116, FR-052…FR-054).
//
// Cubren las cuatro rutas nuevas, y lo que se comprueba en cada una es de dónde salen los
// identificadores y por DÓNDE pasa la petición — dos cosas que un cliente no puede ver y que
// deciden si la curaduría significa algo:
//
//   · El autor y el coordinador salen del TOKEN, nunca del cuerpo. Si salieran del cuerpo,
//     cualquiera podría proponer la calculadora de otro o aprobar la suya escribiendo el
//     identificador de un coordinador de verdad.
//   · La aprobación pasa por el ORQUESTADOR y el resto no. El Simulador no publica eventos
//     (Principio V): si la aprobación fuera directa, el acto de curaduría no quedaría auditado.
//   · El rol es `coordinador_editorial` y NO `administrador` (FR-082).

const cuCalculatorID = "33333333-3333-4333-8333-333333333333"

// Un usuario cualquiera propone la SUYA, y el actor es quien tiene la sesión.
func TestSubmitProposesTheSessionOwnCalculator(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodPost, "/calculators/"+cuCalculatorID+"/submit", `{}`, true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotNil(t, h.simulator.lastRef, "el Simulador tiene que recibir la petición")
	require.Equal(t, cuCalculatorID, h.simulator.lastRef.GetCalculatorId())
	require.Equal(t, testUserID, h.simulator.lastRef.GetActorId(),
		"el actor sale del token, no del cuerpo")
}

// El cuerpo no puede elegir quién propone: un `actor_id` en el JSON se ignora.
//
// Es la prueba que hace segura la ruta. Sin ella, proponer la calculadora de otro sería
// cuestión de escribir un identificador.
func TestSubmitIgnoresAnActorInTheBody(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodPost, "/calculators/"+cuCalculatorID+"/submit",
		`{"actor_id":"99999999-9999-4999-8999-999999999999"}`, true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Equal(t, testUserID, h.simulator.lastRef.GetActorId())
}

// La bandeja de curaduría filtra por estado y NO pide las privadas.
func TestReviewInboxFiltersByState(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleCoordinadorEditoria))

	rec := h.do(t, http.MethodGet, "/editorial/calculators", "", true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	peticion := h.simulator.lastList
	require.NotNil(t, peticion)
	require.Equal(t, "en_revision", peticion.GetState())
	require.Empty(t, peticion.GetOwnerId(),
		"la bandeja no lista «las mías»: lista lo que espera revisión")
	require.False(t, peticion.GetOnlyPublished())
}

// La aprobación pasa por el Orquestador, y el coordinador sale del token.
func TestApproveGoesThroughTheOrchestrator(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleCoordinadorEditoria))
	h.orchestrator.approval = &orchestratorv1.CalculatorApprovalResult{
		CalculatorId: cuCalculatorID,
		Version:      4,
	}

	rec := h.do(t, http.MethodPost, "/editorial/calculators/"+cuCalculatorID+"/approve",
		`{"coordinator_id":"99999999-9999-4999-8999-999999999999"}`, true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotNil(t, h.orchestrator.lastApproval,
		"la aprobación tiene que salir por el Orquestador: es quien publica el evento")
	require.Equal(t, cuCalculatorID, h.orchestrator.lastApproval.GetCalculatorId())
	require.Equal(t, testUserID, h.orchestrator.lastApproval.GetCoordinatorId(),
		"el coordinador sale del token, no del cuerpo")

	// Y la versión publicada viaja al cliente: es lo que le dice al autor cuál de sus versiones
	// quedó en el catálogo.
	require.Contains(t, rec.Body.String(), `"version":4`)
}

// Un rechazo va DIRECTO al Simulador y llueva el motivo.
func TestRejectSendsTheReasonToTheSimulator(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleCoordinadorEditoria))

	rec := h.do(t, http.MethodPost, "/editorial/calculators/"+cuCalculatorID+"/reject",
		`{"reason":"falta explicar de dónde sale la tasa"}`, true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Nil(t, h.orchestrator.lastApproval,
		"un rechazo no se audita: no entra al catálogo")
	rechazo := h.simulator.lastRejection
	require.NotNil(t, rechazo)
	require.Equal(t, "falta explicar de dónde sale la tasa", rechazo.GetReason())
	require.Equal(t, testUserID, rechazo.GetCoordinatorId())
}

// ── roles (FR-082) ──────────────────────────────────────────────────────────

// La curaduría es del coordinador editorial, y el administrador NO la hereda.
//
// FR-082 lo dice con todas las letras: el cuarto rol es independiente. Que las dos familias de
// rutas usen `RequireRole` con roles disjuntos es la garantía de que la separación se mantiene
// aunque un día el mismo usuario acumule los dos roles, y esta prueba es la que la fija.
func TestCurationRolesAreSeparateFromAdministration(t *testing.T) {
	t.Parallel()

	rutas := []struct{ method, target, body string }{
		{http.MethodGet, "/editorial/calculators", ""},
		{http.MethodPost, "/editorial/calculators/" + cuCalculatorID + "/approve", `{}`},
		{http.MethodPost, "/editorial/calculators/" + cuCalculatorID + "/reject", `{"reason":"x"}`},
	}

	t.Run("un usuario final no cura nada", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t)
		for _, ruta := range rutas {
			rec := h.do(t, ruta.method, ruta.target, ruta.body, true)
			require.Equal(t, http.StatusForbidden, rec.Code, ruta.target)
		}
		require.Nil(t, h.orchestrator.lastApproval)
	})

	t.Run("un administrador tampoco", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t, withRoles(handler.RoleAdministrator))
		for _, ruta := range rutas {
			rec := h.do(t, ruta.method, ruta.target, ruta.body, true)
			require.Equal(t, http.StatusForbidden, rec.Code,
				"%s: administrar la plataforma no es aprobar contenido (FR-082)", ruta.target)
		}
		require.Nil(t, h.orchestrator.lastApproval)
	})

	t.Run("un editor tampoco", func(t *testing.T) {
		t.Parallel()
		h := newHarness(t, withRoles(handler.RoleEditor))
		for _, ruta := range rutas {
			rec := h.do(t, ruta.method, ruta.target, ruta.body, true)
			require.Equal(t, http.StatusForbidden, rec.Code, ruta.target)
		}
	})
}

// El 403 de FR-053 viaja como 403 y no como 500.
//
// El Simulador devuelve `PermissionDenied` cuando quien aprueba es el autor, y el Orquestador lo
// conserva dentro de su envoltorio. Si el borde lo colapsara a `Internal`, el coordinador leería
// «error interno» y reintentaría una operación que no le corresponde — y el contrato promete 403.
func TestSelfApprovalSurfacesAsForbidden(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleCoordinadorEditoria))
	h.orchestrator.approvalErr = status.Error(codes.PermissionDenied, "nadie aprueba su propia calculadora")

	rec := h.do(t, http.MethodPost, "/editorial/calculators/"+cuCalculatorID+"/approve", `{}`, true)

	require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
}
