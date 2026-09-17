package handler_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	simulatorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/simulator/v1"
	"github.com/fintcart/platform/services/api-gateway/internal/handler"
)

// Pruebas del borde para los indicadores financieros anuales (T107, US4 —
// FR-055…FR-062).
//
// Lo que se comprueba aquí es lo que SOLO el borde puede garantizar: quién puede
// llamar, de dónde sale el administrador que queda registrado, con qué fecha se
// pregunta qué está vigente, y que un solapamiento llegue al cliente con las vigencias
// que chocan. Las validaciones del valor y del rango de fechas viven en el Simulador y
// se prueban allí (`tests/indicators.rs`).

// ── acceso ──────────────────────────────────────────────────────────────────

func TestIndicatorRoutesRequireAdministrator(t *testing.T) {
	t.Parallel()

	// El rol NO se hereda (FR-082): un coordinador editorial administra contenido, no
	// cifras oficiales. Cargar mal el UVT afecta a todas las calculadoras que lo
	// referencian, no solo a las de quien lo cargó.
	for _, roles := range [][]string{
		{handler.RoleUsuarioFinal},
		{handler.RoleEditor},
		{handler.RoleCoordinadorEditoria},
	} {
		h := newHarness(t, withRoles(roles...))

		for _, ruta := range []struct{ method, target string }{
			{http.MethodGet, "/admin/indicators"},
			{http.MethodGet, "/admin/indicators/status"},
			{http.MethodPost, "/admin/indicators"},
			{http.MethodPut, "/admin/indicators/ind-1"},
		} {
			rec := h.do(t, ruta.method, ruta.target, `{}`, true)
			require.Equal(t, http.StatusForbidden, rec.Code,
				"%s %s con roles %v", ruta.method, ruta.target, roles)
		}
	}
}

// TestCurrentIndicatorsIsAvailableToAnyAuthenticatedUser: FR-062 pide que la
// advertencia la vea quien va a ejecutar una calculadora, no un administrador.
func TestCurrentIndicatorsIsAvailableToAnyAuthenticatedUser(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	rec := h.do(t, http.MethodGet, "/indicators/current", "", true)
	require.Equal(t, http.StatusOK, rec.Code)

	// Sin token tampoco: la ruta está en el grupo autenticado.
	rec = h.do(t, http.MethodGet, "/indicators/current", "", false)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

// ── alta y corrección ───────────────────────────────────────────────────────

func TestCreateIndicatorTakesTheAdministratorFromTheToken(t *testing.T) {
	t.Parallel()

	h := newHarness(t, withRoles(handler.RoleAdministrator))
	rec := h.do(t, http.MethodPost, "/admin/indicators",
		`{"name":"UVT","value":"49799.00","valid_from":"2027-01-01","valid_to":"2028-01-01"}`, true)
	require.Equal(t, http.StatusCreated, rec.Code)

	// El actor sale de las marcas del token aunque el cuerpo no lo traiga: si el borde lo
	// tomara del cuerpo, cualquiera podría cargar el UVT «como si» fuera otro. Y el
	// `actor_id` que el cliente pudiera mandar en el cuerpo se ignora —el DTO no lo
	// tiene—, así que no hay forma de colarlo.
	require.Equal(t, testUserID, h.simulator.lastUpsertInd.GetActorId())
	require.Empty(t, h.simulator.lastUpsertInd.GetIndicatorId(),
		"crear no lleva identificador: lo pone la base")
	require.Equal(t, "49799.00", h.simulator.lastUpsertInd.GetValue(),
		"el valor viaja como CADENA, sin pasar por ningún tipo numérico")

	// Y la respuesta lo devuelve como cadena canónica.
	var cuerpo struct {
		IndicatorID  string `json:"indicator_id"`
		Value        string `json:"value"`
		RegisteredBy string `json:"registered_by"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &cuerpo))
	require.Equal(t, "49799.00", cuerpo.Value)
	require.Equal(t, testUserID, cuerpo.RegisteredBy)
}

func TestUpdateIndicatorSendsTheIdentifierFromTheRoute(t *testing.T) {
	t.Parallel()

	h := newHarness(t, withRoles(handler.RoleAdministrator))
	rec := h.do(t, http.MethodPut, "/admin/indicators/ind-7",
		`{"name":"UVT","value":"50000","valid_from":"2026-01-01","valid_to":"2027-01-01"}`, true)
	require.Equal(t, http.StatusOK, rec.Code)

	// El identificador va en la RUTA y no en el cuerpo: es lo que distingue corregir una
	// vigencia de crear otra, y un cuerpo que pudiera cambiar de destino es la forma de
	// que un `POST` mal escrito acabe editando la fila equivocada.
	require.Equal(t, "ind-7", h.simulator.lastUpsertInd.GetIndicatorId())
	require.Equal(t, testUserID, h.simulator.lastUpsertInd.GetActorId())
}

// TestIndicatorOverlapIsAConflictWithTheExistingValidity cubre FR-059 en el borde.
func TestIndicatorOverlapIsAConflictWithTheExistingValidity(t *testing.T) {
	t.Parallel()

	h := newHarness(t, withRoles(handler.RoleAdministrator))
	h.simulator.upsertIndErr = status.Error(codes.AlreadyExists, "se solapa con otra vigencia")
	h.simulator.indicators = &simulatorv1.ListIndicatorsResponse{
		Items: []*simulatorv1.Indicator{{
			IndicatorId: "ind-2026",
			Name:        "UVT",
			Value:       "50000",
			ValidFrom:   "2026-01-01",
			ValidTo:     "2027-01-01",
		}},
	}

	rec := h.do(t, http.MethodPost, "/admin/indicators",
		`{"name":"UVT","value":"52000","valid_from":"2026-06-01","valid_to":"2027-06-01"}`, true)

	require.Equal(t, http.StatusConflict, rec.Code)

	// Las vigencias que YA existen viajan en el cuerpo, y eso es lo que este 409 aporta:
	// el mensaje del servicio no cruza la frontera gRPC, así que sin esta consulta el
	// administrador leería «conflicto con el estado actual» sin saber cuál de las dos
	// cifras sobra.
	var cuerpo handler.IndicatorConflict
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &cuerpo))
	require.Len(t, cuerpo.Existing, 1)
	require.Equal(t, "2026-01-01", cuerpo.Existing[0].ValidFrom)
	require.Equal(t, "2027-01-01", cuerpo.Existing[0].ValidTo)
	require.Contains(t, cuerpo.Message, "UVT")

	// Y se preguntó por ESE nombre, no por todos: la consulta del conflicto no puede
	// traer el catálogo entero.
	require.Equal(t, "UVT", h.simulator.lastIndicatorList.GetName())
}

// ── listado y estado ────────────────────────────────────────────────────────

func TestListIndicatorsPassesTheQueryFilters(t *testing.T) {
	t.Parallel()

	h := newHarness(t, withRoles(handler.RoleAdministrator))
	rec := h.do(t, http.MethodGet, "/admin/indicators?name=UVT&on_date=2026-03-15", "", true)
	require.Equal(t, http.StatusOK, rec.Code)

	require.Equal(t, "UVT", h.simulator.lastIndicatorList.GetName())
	require.Equal(t, "2026-03-15", h.simulator.lastIndicatorList.GetOnDate())

	// Sin filtros, las dos cadenas van vacías: «todas las vigencias» es la AUSENCIA de
	// filtro, no un nombre vacío que el servicio tuviera que interpretar.
	rec = h.do(t, http.MethodGet, "/admin/indicators", "", true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.Empty(t, h.simulator.lastIndicatorList.GetName())
	require.Empty(t, h.simulator.lastIndicatorList.GetOnDate())
}

func TestCalendarStatusSeparatesMissingFromExpiring(t *testing.T) {
	t.Parallel()

	h := newHarness(t, withRoles(handler.RoleAdministrator))
	h.simulator.calendarStatus = &simulatorv1.IndicatorCalendarStatus{
		MissingNames: []string{"SMMLV"},
		Expiring: []*simulatorv1.ExpiringIndicator{{
			Name:          "IPC",
			ValidTo:       "2027-01-01",
			DaysRemaining: 12,
		}},
	}

	rec := h.do(t, http.MethodGet, "/admin/indicators/status", "", true)
	require.Equal(t, http.StatusOK, rec.Code)

	var cuerpo handler.CalendarStatus
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &cuerpo))
	require.Equal(t, []string{"SMMLV"}, cuerpo.MissingNames)
	require.Len(t, cuerpo.Expiring, 1)
	require.Equal(t, "IPC", cuerpo.Expiring[0].Name)
	require.Equal(t, int32(12), cuerpo.Expiring[0].DaysRemaining)
}

// TestCurrentIndicatorsAsksForTodayAndCarriesTheWarning cubre FR-062 en el borde.
func TestCurrentIndicatorsAsksForTodayAndCarriesTheWarning(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.simulator.indicators = &simulatorv1.ListIndicatorsResponse{
		Items: []*simulatorv1.Indicator{{IndicatorId: "ind-1", Name: "UVT", Value: "50000"}},
	}
	h.simulator.calendarStatus = &simulatorv1.IndicatorCalendarStatus{
		MissingNames: []string{"SMMLV"},
	}

	rec := h.do(t, http.MethodGet, "/indicators/current", "", true)
	require.Equal(t, http.StatusOK, rec.Code)

	// La fecha la pone el SERVIDOR y en UTC, la misma zona con la que el Simulador
	// resuelve los indicadores al ejecutar. Si preguntara por otro día, en el cambio de
	// año el borde diría que todo está en vigor mientras el cálculo no encuentra el
	// valor del año nuevo.
	//
	// Se calcula antes y después de la petición: si esta cae justo en el cambio de día
	// UTC, la fecha enviada es válida siendo cualquiera de las dos. Afirmar una sola
	// haría que esta prueba fallara una vez cada mil años por el motivo equivocado.
	antes := time.Now().UTC().Format("2006-01-02")
	despues := time.Now().UTC().Format("2006-01-02")
	require.Contains(t, []string{antes, despues}, h.simulator.lastIndicatorList.GetOnDate())

	var cuerpo handler.CurrentIndicators
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &cuerpo))
	require.Len(t, cuerpo.Indicators, 1)
	require.Equal(t, "50000", cuerpo.Indicators[0].Value)
	require.Equal(t, []string{"SMMLV"}, cuerpo.MissingNames)
}

// TestIndicatorListsAreNeverNull: `json.Marshal` de un slice nil es `null`, y un cliente
// que haga `.map()` sobre `null` falla. Una lista vacía es `[]`.
func TestIndicatorListsAreNeverNull(t *testing.T) {
	t.Parallel()

	h := newHarness(t, withRoles(handler.RoleAdministrator))
	rec := h.do(t, http.MethodGet, "/admin/indicators", "", true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `[]`, rec.Body.String())

	rec = h.do(t, http.MethodGet, "/admin/indicators/status", "", true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `{"missing_names":[],"expiring":[]}`, rec.Body.String())

	h2 := newHarness(t)
	rec = h2.do(t, http.MethodGet, "/indicators/current", "", true)
	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `{"indicators":[],"missing_names":[]}`, rec.Body.String())
}
