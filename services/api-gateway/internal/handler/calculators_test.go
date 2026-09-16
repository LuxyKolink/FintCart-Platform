package handler_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
	simulatorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/simulator/v1"
)

// Cuerpo mínimo de una calculadora: una entrada, ninguna regla y una salida.
//
// Los montos y las cotas van como CADENA (`"1000.00"`) y no como número JSON, que es lo
// que el Principio VIII exige en el borde: un número aquí se convertiría en `float64` al
// deserializarlo y perdería centavos antes de llegar al Simulador.
const cuerpoCalculadora = `{
  "name": "Mi calculadora",
  "description": "una prueba",
  "definition": {
    "inputs": [{"key":"monto","label":"Monto","type":"monto","unit":"COP","min_value":"1000.00","required":true}],
    "validations": [{"expression":"monto > 0","message":"el monto debe ser positivo"}],
    "outputs": [{"key":"doble","label":"Doble","expression":"monto * 2","scale":2}]
  }
}`

// ── el 422 con errors[] (FR-046) ────────────────────────────────────────────

// Un 422 lleva los problemas UNO A UNO, con su ubicación.
//
// Es la razón de que esta ruta valide antes de guardar: `UpsertCalculator` responde con un
// `InvalidArgument` cuyo mensaje ya ha aplanado la lista a un párrafo, y FR-046 exige
// señalar el error CONCRETO para que el constructor pueda resaltar el campo. Un mensaje
// único obligaría al autor a corregir sus seis erratas de una en una.
func TestCreateCalculatorReturns422WithLocatedErrors(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.simulator.report = &simulatorv1.ValidateDefinitionResponse{
		Valid: false,
		Errors: []*simulatorv1.DefinitionError{
			{
				Location: "outputs[1].expression",
				Code:     "campo_inexistente",
				Message:  "no existe el campo «monto_menusal»",
			},
			{
				Location: "inputs[0].min_value",
				Code:     "definicion_invalida",
				Message:  "el mínimo es mayor que el máximo",
			},
		},
	}

	rec := h.do(t, http.MethodPost, "/calculators", cuerpoCalculadora, true)

	require.Equal(t, http.StatusUnprocessableEntity, rec.Code)

	var body struct {
		Code   string `json:"code"`
		Errors []struct {
			Location string `json:"location"`
			Code     string `json:"code"`
			Message  string `json:"message"`
		} `json:"errors"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))

	require.Len(t, body.Errors, 2, "los dos problemas, no solo el primero")
	assert.Equal(t, "outputs[1].expression", body.Errors[0].Location)
	assert.Equal(t, "campo_inexistente", body.Errors[0].Code)
	assert.Equal(t, "inputs[0].min_value", body.Errors[1].Location)
	assert.NotEmpty(t, body.Code, "el cuerpo conserva el `code` del resto del borde")

	assert.Zero(t, h.simulator.upsertCalls,
		"una definición que no analiza no se guarda: sería una calculadora que no corre")
}

// Y con una definición válida sí se guarda, con el titular del TOKEN.
//
// `owner_id` sale de las reclamaciones y no del cuerpo: si lo aceptara del cliente, un
// usuario podría crear calculadoras a nombre de otro.
func TestCreateCalculatorSavesWhenTheDefinitionIsValid(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodPost, "/calculators", cuerpoCalculadora, true)

	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	require.NotNil(t, h.simulator.lastUpsert)
	assert.Equal(t, testUserID, h.simulator.lastUpsert.GetOwnerId())
	assert.Empty(t, h.simulator.lastUpsert.GetCalculatorId(), "crear no cita ninguna calculadora")
	assert.Equal(t, "Mi calculadora", h.simulator.lastUpsert.GetName())
	require.Len(t, h.simulator.lastUpsert.GetDefinition().GetInputs(), 1)
	assert.Equal(t, "1000.00", h.simulator.lastUpsert.GetDefinition().GetInputs()[0].GetMinValue(),
		"la cadena decimal cruza el borde sin que nadie la interprete")
}

// Editar cita la calculadora, y el Simulador decide qué hacer con eso.
//
// El borde NO decide si esto crea una versión nueva: eso es FR-050 y vive en el Simulador,
// donde está la tabla. Aquí solo se comprueba que el identificador de la URL llega como
// `calculator_id` en lugar de perderse, que es el fallo que esta prueba existe para
// atrapar — sin él, un `PUT` crearía una calculadora nueva en vez de versionar la que el
// autor estaba editando.
func TestUpdateCalculatorForwardsTheIdFromThePath(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodPut, "/calculators/calc-7", cuerpoCalculadora, true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotNil(t, h.simulator.lastUpsert)
	assert.Equal(t, "calc-7", h.simulator.lastUpsert.GetCalculatorId())
}

// ── validar no es guardar ───────────────────────────────────────────────────

// La validación en vivo responde 200 con la lista, y NO toca la base.
//
// 200 y no 422 porque aquí «inválida» es una respuesta legítima a una pregunta legítima: el
// autor está preguntando mientras escribe, no guardando. Devolver 422 obligaría a su cliente
// a tratar como error algo que ha ido perfectamente bien.
func TestValidateDoesNotSaveAndAnswers200(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.simulator.report = &simulatorv1.ValidateDefinitionResponse{
		Valid: false,
		Errors: []*simulatorv1.DefinitionError{
			{Location: "outputs[0].expression", Code: "expresion_mal_formada", Message: "falta un paréntesis"},
		},
	}

	rec := h.do(t, http.MethodPost, "/calculators/validate", cuerpoCalculadora, true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var body struct {
		Valid  bool `json:"valid"`
		Errors []struct {
			Location string `json:"location"`
		} `json:"errors"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.False(t, body.Valid)
	require.Len(t, body.Errors, 1)
	assert.Equal(t, "outputs[0].expression", body.Errors[0].Location)

	assert.Zero(t, h.simulator.upsertCalls, "validar no guarda nada")
}

// `/calculators/validate` NO se lee como un identificador de calculadora.
//
// chi resuelve por patrón: si `/calculators/{calculatorId}` se registrara antes que el
// segmento literal, «validate» entraría por ahí como identificador y la validación en vivo
// del constructor respondería 404 sobre su propia ruta. Es un fallo de una línea en
// `routes.go` que ninguna otra prueba vería, porque las dos rutas existen y las dos
// compilan.
func TestValidateRouteIsNotTakenAsACalculatorId(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodPost, "/calculators/validate", cuerpoCalculadora, true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotNil(t, h.simulator.lastValidate, "la petición tenía que llegar a ValidateDefinition")
	assert.Nil(t, h.simulator.lastRef, "y no haberse leído como una calculadora llamada «validate»")
}

// ── catálogo y visibilidad ──────────────────────────────────────────────────

// El catálogo de calculadoras es PÚBLICO y solo trae publicadas.
//
// Público porque el contrato lo marca así, como el de categorías: se consulta antes de
// entrar. Y solo publicadas porque el filtro lo impone la CONSULTA —`only_published`— y no
// un parámetro que este borde pudiera olvidar de poner: una calculadora privada en el
// catálogo público sería la fuga que FR-051 prohíbe.
func TestCalculatorCatalogIsPublicAndOnlyPublished(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodGet, "/calculators", "", false)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotNil(t, h.simulator.lastList)
	assert.True(t, h.simulator.lastList.GetOnlyPublished())
	assert.Empty(t, h.simulator.lastList.GetOwnerId(),
		"el catálogo público no se filtra por titular")
}

// Las propias salen del TOKEN y no de la URL (FR-051).
//
// Es la misma decisión que en el resto de `/me/*`: si el titular se pudiera pedir por
// parámetro, existiría la posibilidad de listar las calculadoras privadas de otro
// cambiando un identificador.
func TestMyCalculatorsUseTheTokenNotTheUrl(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodGet, "/me/calculators", "", true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotNil(t, h.simulator.lastList)
	assert.Equal(t, testUserID, h.simulator.lastList.GetOwnerId())
	assert.False(t, h.simulator.lastList.GetOnlyPublished(),
		"las propias incluyen las privadas: son de quien pregunta")
}

// Leer una calculadora lleva el actor, para que la visibilidad la decida la CONSULTA.
//
// El borde no puede comprobar FR-051 por su cuenta: tendría que leer la fila antes de
// decidir, y entre la lectura y la decisión cabría un cambio de estado.
func TestGetCalculatorForwardsTheActor(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	rec := h.do(t, http.MethodGet, "/calculators/calc-3", "", true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotNil(t, h.simulator.lastRef)
	assert.Equal(t, "calc-3", h.simulator.lastRef.GetCalculatorId())
	assert.Equal(t, testUserID, h.simulator.lastRef.GetActorId())
}

// Sin token, las rutas autenticadas del constructor no se sirven.
func TestCalculatorRoutesRequireAuthentication(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	for _, tc := range []struct{ method, target string }{
		{http.MethodPost, "/calculators"},
		{http.MethodPut, "/calculators/calc-1"},
		{http.MethodDelete, "/calculators/calc-1"},
		{http.MethodGet, "/calculators/calc-1"},
		{http.MethodPost, "/calculators/validate"},
		{http.MethodGet, "/me/calculators"},
	} {
		rec := h.do(t, tc.method, tc.target, cuerpoCalculadora, false)
		assert.Equal(t, http.StatusUnauthorized, rec.Code, "%s %s", tc.method, tc.target)
	}
}

// ── el vocabulario del borde ────────────────────────────────────────────────

// Un tipo de entrada desconocido es un 400 del BORDE, no un enum cero hacia dentro.
//
// Dejarlo pasar como `INPUT_TYPE_UNSPECIFIED` haría que el Simulador recibiera «el cliente
// olvidó el campo», que es un diagnóstico distinto —y peor— que «el cliente escribió un
// tipo que no existe»: el autor se pondría a revisar un campo que sí rellenó.
//
// Y el mensaje NOMBRA la entrada que falla, que es la mitad útil del error: un «petición
// inválida» a secas, con veinte entradas declaradas y una errata en la segunda, obliga a
// buscarla a ojo. El borde redacta ese detalle a partir de la entrada del cliente, así que
// mostrarlo no filtra nada de la infraestructura —la razón por la que los mensajes de los
// servicios internos sí van fijos—, y va con `%q`, que escapa lo que haga falta.
func TestAnUnknownInputTypeIsRejectedAtTheEdge(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	cuerpo := `{"name":"x","description":"","definition":{
      "inputs":[{"key":"a","label":"A","type":"monto"},{"key":"b","label":"B","type":"porcentaje"}],
      "validations":[],"outputs":[{"key":"o","label":"O","expression":"a","scale":2}]}}`

	rec := h.do(t, http.MethodPost, "/calculators", cuerpo, true)

	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "inputs[1].type",
		"el autor tiene que saber CUÁL de las entradas falla")
	assert.Contains(t, rec.Body.String(), "porcentaje",
		"y conviene que vea el valor que escribió, para reconocer la errata")
	assert.Zero(t, h.simulator.upsertCalls, "un tipo que no es del contrato no llega a guardarse")
	assert.Nil(t, h.simulator.lastValidate, "no se llega a validar: el tipo no es del contrato")
}

// Las cotas viajan como cadena y la cadena VACÍA significa «sin cota».
//
// La distinción es real y no cosmética: un mínimo de `0` prohíbe los negativos y la ausencia
// de mínimo no prohíbe nada. Si el borde convirtiera la ausencia en `"0"`, toda calculadora
// con una cota opcional dejaría de aceptar negativos sin que su autor lo hubiera pedido.
func TestAnAbsentBoundStaysAbsentAndIsNotZero(t *testing.T) {
	t.Parallel()
	h := newHarness(t)

	cuerpo := `{"name":"x","description":"","definition":{
      "inputs":[{"key":"a","label":"A","type":"monto","min_value":"","max_value":"500.00"}],
      "validations":[],"outputs":[{"key":"o","label":"O","expression":"a","scale":2}]}}`

	rec := h.do(t, http.MethodPost, "/calculators", cuerpo, true)

	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	entrada := h.simulator.lastUpsert.GetDefinition().GetInputs()[0]
	assert.Empty(t, entrada.GetMinValue(), "sin mínimo sigue sin mínimo")
	assert.Equal(t, "500.00", entrada.GetMaxValue())
}

// ── ejecutar una calculadora ────────────────────────────────────────────────

// Ejecutar recorre la MISMA saga que el camino nativo (FR-050, FR-025, D-03).
//
// Es lo que hace que la ejecución quede auditada: el Simulador no es productor de eventos,
// así que llamarlo directamente desde aquí sería más corto y dejaría la simulación fuera del
// registro. La prueba fija las dos cosas que hacen falta para que la mediación funcione —el
// identificador llega, y el tipo nativo NO— porque una petición con los dos el Simulador la
// rechaza, y una sin ninguno no identifica nada.
func TestRunCalculatorGoesThroughTheSagaWithTheIdAndNoCalcType(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.orchestrator.simulation = &orchestratorv1.SimulationResult{
		SimulationId: "sim-1",
		Result:       map[string]string{"salida": "3000"},
	}

	rec := h.do(t, http.MethodPost, "/calculators/calc-7/run",
		`{"currency":"COP","inputs":{"monto":"1500.00"}}`, true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotNil(t, h.orchestrator.lastSimulation)
	assert.Equal(t, "calc-7", h.orchestrator.lastSimulation.GetCalculatorId())
	assert.Equal(t, simulatorv1.CalcType_CALC_TYPE_UNSPECIFIED, h.orchestrator.lastSimulation.GetCalcType(),
		"con calculadora no se manda tipo nativo: son excluyentes")
	assert.Equal(t, testUserID, h.orchestrator.lastSimulation.GetUserId(),
		"el titular sale del token, no del cuerpo")
	assert.Equal(t, "1500.00", h.orchestrator.lastSimulation.GetInputs()["monto"],
		"el monto cruza como cadena, sin que el borde lo interprete")
}

// Sin moneda se asume COP (FR-020), igual que en el camino nativo.
//
// Las dos rutas de ejecución tienen que comportarse igual en esto: si una exigiera la
// moneda y la otra la asumiera, el mismo cliente funcionaría por una y fallaría por la
// otra según cómo hubiera llegado a la calculadora.
func TestRunCalculatorDefaultsTheCurrency(t *testing.T) {
	t.Parallel()
	h := newHarness(t)
	h.orchestrator.simulation = &orchestratorv1.SimulationResult{SimulationId: "sim-1"}

	rec := h.do(t, http.MethodPost, "/calculators/calc-7/run", `{"inputs":{"monto":"1.00"}}`, true)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotNil(t, h.orchestrator.lastSimulation)
	assert.Equal(t, "COP", h.orchestrator.lastSimulation.GetCurrency())
}
