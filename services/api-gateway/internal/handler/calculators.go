package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
	simulatorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/simulator/v1"
)

// Rutas del constructor de calculadoras: `/calculators/*` y `/me/calculators`.

// ListCalculators ≡ `GET /calculators` — catálogo público de calculadoras publicadas.
//
// Es PÚBLICA (el contrato la marca `security: []`, igual que `/catalog/categories`) y por
// eso vive fuera del grupo autenticado. Solo devuelve publicadas, y ese filtro lo impone la
// CONSULTA y no un parámetro que este borde pudiera olvidar: una calculadora privada en el
// catálogo público sería la fuga que FR-051 prohíbe.
func (h *Handler) ListCalculators(w http.ResponseWriter, r *http.Request) {
	resp, err := h.clients.Simulator.ListCalculators(r.Context(), &simulatorv1.ListCalculatorsRequest{
		OnlyPublished: true,
		Page:          pageRequestFrom(r),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, pageOf(calculatorsToDTO(resp.GetItems()), resp.GetPage()))
}

// ListMyCalculators ≡ `GET /me/calculators` (FR-051).
//
// Las propias, publicadas o no. El titular sale del TOKEN y no de la URL, de modo que no
// existe la posibilidad de listar las de otro cambiando un identificador — la misma razón
// por la que `/me/*` no lleva `{userId}`.
func (h *Handler) ListMyCalculators(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Simulator.ListCalculators(r.Context(), &simulatorv1.ListCalculatorsRequest{
		OwnerId: claims.UserID,
		Page:    pageRequestFrom(r),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, pageOf(calculatorsToDTO(resp.GetItems()), resp.GetPage()))
}

// GetCalculator ≡ `GET /calculators/{calculatorId}`.
//
// El `actor_id` va en la petición porque la VISIBILIDAD es una regla de la fila y no de la
// petición (FR-051): una calculadora privada solo la ve su autor, y quien lo decide es la
// consulta del Simulador. Comprobarlo aquí obligaría a leer la fila antes de decidir, y
// entre la lectura y la decisión cabría un cambio de estado.
func (h *Handler) GetCalculator(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Simulator.GetCalculator(r.Context(), &simulatorv1.CalculatorRef{
		CalculatorId: chi.URLParam(r, "calculatorId"),
		ActorId:      claims.UserID,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, calculatorToDTO(resp))
}

// CreateCalculator ≡ `POST /calculators` (FR-043).
func (h *Handler) CreateCalculator(w http.ResponseWriter, r *http.Request) {
	h.writeCalculator(w, r, "")
}

// UpdateCalculator ≡ `PUT /calculators/{calculatorId}`.
//
// Sustituir la definición NO la sobrescribe: el Simulador inserta una versión nueva y sube
// el número (FR-050). Es lo que permite que la versión publicada siga sirviendo mientras su
// autor edita la siguiente, y lo que hace que una simulación de hace un año siga
// explicándose con la fórmula con la que se calculó.
func (h *Handler) UpdateCalculator(w http.ResponseWriter, r *http.Request) {
	h.writeCalculator(w, r, chi.URLParam(r, "calculatorId"))
}

// writeCalculator es el camino común de crear y editar.
//
// ## Por qué ANALIZA antes de guardar, y por qué eso no es una duplicación
//
// El 422 del contrato lleva `errors[]` con `location`, `code` y `message` —FR-046 exige
// señalar el error concreto y no un mensaje único—, y `UpsertCalculator` NO los devuelve:
// cuando la definición no analiza responde con un `InvalidArgument` cuyo mensaje ya ha
// aplanado la lista a un texto. `ValidateDefinition` sí devuelve la lista estructurada.
//
// Así que este borde valida primero y guarda después. Cuesta un análisis de más —el
// Simulador analiza la definición dos veces—, y sobre un AST acotado a 64 nodos eso es
// despreciable frente a lo que se gana: el autor recibe los seis errores de sus seis salidas
// de una vez, en vez del primero de ellos convertido en un párrafo.
//
// `existing` vacío crea; con identificador, edita.
func (h *Handler) writeCalculator(w http.ResponseWriter, r *http.Request, existing string) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	var body CalculatorWriteRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	definition, err := definitionFromDTO(body.Definition)
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	report, err := h.clients.Simulator.ValidateDefinition(r.Context(),
		&simulatorv1.ValidateDefinitionRequest{Definition: definition})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}
	if !report.GetValid() {
		// 422 y no 400: la petición está bien FORMADA —es JSON válido con los campos que
		// el contrato declara— y lo que no se puede procesar es su CONTENIDO. La
		// distinción importa para el cliente: un 400 le dice «has construido mal la
		// petición», y esto no es eso.
		writeJSON(w, http.StatusUnprocessableEntity, DefinitionRejected{
			Code:    "definicion_invalida",
			Message: "la definición tiene problemas que hay que corregir antes de guardarla",
			Errors:  issuesToDTO(report.GetErrors()),
		})
		return
	}

	saved, err := h.clients.Simulator.UpsertCalculator(r.Context(), &simulatorv1.UpsertCalculatorRequest{
		CalculatorId: existing,
		OwnerId:      claims.UserID,
		Name:         body.Name,
		Description:  body.Description,
		Definition:   definition,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	status := http.StatusOK
	if existing == "" {
		status = http.StatusCreated
	}
	writeJSON(w, status, calculatorToDTO(saved))
}

// ValidateDefinition ≡ `POST /calculators/validate`.
//
// No guarda nada: alimenta el aviso en vivo del constructor mientras el autor escribe. Se
// responde 200 con `valid` y la lista, y no un 422, porque aquí «inválida» es una respuesta
// LEGÍTIMA a una pregunta legítima —el autor está preguntando, no guardando—, y un 422
// obligaría a su cliente a tratar como error algo que ha ido perfectamente bien.
func (h *Handler) ValidateDefinition(w http.ResponseWriter, r *http.Request) {
	var body CalculatorWriteRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	definition, err := definitionFromDTO(body.Definition)
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	report, err := h.clients.Simulator.ValidateDefinition(r.Context(),
		&simulatorv1.ValidateDefinitionRequest{Definition: definition})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, DefinitionReport{
		Valid:  report.GetValid(),
		Errors: issuesToDTO(report.GetErrors()),
	})
}

// RunCalculator ≡ `POST /calculators/{calculatorId}/run` (FR-050).
//
// Va al ORQUESTADOR y no directamente al Simulador, por la misma razón que
// `/simulators/{calcType}/run`: el Simulador **no es productor de eventos**, y toda
// simulación tiene que quedar auditada (FR-025, SC-006, research D-03). Llamar aquí al
// Simulador sería más corto y dejaría la ejecución fuera del registro.
//
// `CalcType` no se rellena a propósito: los dos campos son excluyentes y el Simulador
// rechaza la petición que traiga ambos, así que enviarlo en su valor cero es lo que hace
// que un error aquí falle de forma visible en vez de que uno de los dos se ignore.
//
// Los `inputs` viajan como `map[string]string` de extremo a extremo, sin que este borde
// los parsee: convertirlos a `float64` para «validarlos» rompería el Principio VIII en la
// frontera y duplicaría una validación que el Simulador hace con `rust_decimal`.
func (h *Handler) RunCalculator(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	var body SimulationRequest
	if err := decodeJSON(w, r, &body); err != nil {
		h.writeGRPCError(w, r, err)
		return
	}
	if body.Currency == "" {
		body.Currency = defaultCurrency
	}

	resp, err := h.clients.Orchestrator.StartSimulation(r.Context(), &orchestratorv1.SimulationRequest{
		UserId:       claims.UserID,
		CalculatorId: chi.URLParam(r, "calculatorId"),
		Currency:     body.Currency,
		Inputs:       body.Inputs,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, simulationToDTO(resp))
}

// DeleteCalculator ≡ `DELETE /calculators/{calculatorId}`.
//
// El Simulador rechaza borrar una calculadora que alguna simulación del historial cita
// (FR-050): borrarla dejaría esas filas sin poder explicarse. Ese rechazo llega aquí como
// `InvalidArgument` y sale como 400 con el mensaje del contrato.
func (h *Handler) DeleteCalculator(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Simulator.DeleteCalculator(r.Context(), &simulatorv1.CalculatorRef{
		CalculatorId: chi.URLParam(r, "calculatorId"),
		ActorId:      claims.UserID,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, opToDTO(resp))
}
