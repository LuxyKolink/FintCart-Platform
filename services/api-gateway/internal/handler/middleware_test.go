package handler_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/fintcart/platform/services/api-gateway/internal/handler"
)

// Pruebas de la POLÍTICA DE ACCESO del rol `administrador` (T031).
//
// Viven en un archivo aparte porque son las tres afirmaciones que separan al
// cuarto rol de los tres de FR-006: quién puede entrar en `/admin/**` (solo él,
// FR-081) y a qué no entra él mismo (FR-082). Se ejercitan contra el router
// COMPLETO —no contra `RequireRole` aislado— porque la pregunta que responden no
// es «¿comprueba el middleware el rol?» sino «¿quedó montado en las rutas que
// dicen los comentarios?».

// TestAdminRoutesRejectEveryoneWithoutTheAdministratorRole fija que `/admin/**`
// exige el rol y que ningún otro rol de FR-006 sirve.
func TestAdminRoutesRejectEveryoneWithoutTheAdministratorRole(t *testing.T) {
	t.Parallel()

	t.Run("rol ausente → 403", func(t *testing.T) {
		t.Parallel()
		// El usuario final del andamiaje no tiene ningún rol administrativo.
		h := newHarness(t)
		for _, call := range []struct{ method, target, body string }{
			{http.MethodGet, "/admin/categories", ""},
			{http.MethodPost, "/admin/categories", `{"name":"Ahorro"}`},
			{http.MethodPatch, "/admin/categories/cat-1", `{"name":"Ahorro"}`},
			{http.MethodDelete, "/admin/categories/cat-1", ""},
		} {
			rec := h.do(t, call.method, call.target, call.body, true)
			require.Equal(t, http.StatusForbidden, rec.Code, "%s %s", call.method, call.target)
			require.Equal(t, "forbidden", decode[handler.ErrorBody](t, rec).Code)
		}
	})

	t.Run("el coordinador_editorial no administra (FR-082)", func(t *testing.T) {
		t.Parallel()
		// Aprobar contenido editorial y administrar el catálogo son atribuciones
		// separadas: tener la primera no concede la segunda.
		h := newHarness(t, withRoles(handler.RoleCoordinadorEditoria))

		rec := h.do(t, http.MethodPost, "/admin/categories", `{"name":"Ahorro"}`, true)
		require.Equal(t, http.StatusForbidden, rec.Code)

		rec = h.do(t, http.MethodDelete, "/admin/categories/cat-1", "", true)
		require.Equal(t, http.StatusForbidden, rec.Code)
	})
}

// TestAdministratorDoesNotInheritEditorialPowers es la otra mitad de FR-082: el
// rol `administrador` NO se añade a las atribuciones de `coordinador_editorial`,
// así que no puede crear borradores ni —menos aún— publicar.
func TestAdministratorDoesNotInheritEditorialPowers(t *testing.T) {
	t.Parallel()
	h := newHarness(t, withRoles(handler.RoleAdministrator))

	rec := h.do(t, http.MethodPost, "/editorial/articles", `{"title":"t","body":"b"}`, true)
	require.Equal(t, http.StatusForbidden, rec.Code)

	rec = h.do(t, http.MethodPost, "/editorial/versions/v-1/publish", `{}`, true)
	require.Equal(t, http.StatusForbidden, rec.Code)
}
