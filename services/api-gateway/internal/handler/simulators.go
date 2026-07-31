package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
	simulatorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/simulator/v1"
)

// Rutas de simuladores: `/simulators/*`.

// defaultCurrency es la moneda que se asume si el cliente no la envía (FR-020).
const defaultCurrency = "COP"

// RunSimulation ≡ `POST /simulators/{calcType}/run`.
//
// Va al ORQUESTADOR y no directamente al Simulador, aunque la operación toque un solo
// servicio. El motivo es research D-03: **el Simulador no es productor de eventos**, y
// las simulaciones tienen que auditarse (FR-025, SC-006). El único productor autorizado
// que puede emitir `simulation.executed` es el Orquestador, así que la llamada se media.
//
// Los `inputs` viajan como `map[string]string` de extremo a extremo. El Gateway NO los
// parsea: son montos, tasas y plazos, y convertirlos aquí a `float64` para «validarlos»
// rompería el Principio VIII en el borde —además de duplicar una validación que el
// Simulador ya hace con `rust_decimal` y su helper `decimal_str`.
func (h *Handler) RunSimulation(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	// La traducción del segmento de URL al enum es responsabilidad del borde y es
	// explícita: un valor desconocido da 400 aquí, no un enum cero que el Simulador
	// pudiera interpretar como el primer tipo de cálculo de la lista.
	calcType, err := calcTypeFromPath(chi.URLParam(r, "calcType"))
	if err != nil {
		h.writeGRPCError(w, r, err)
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
		UserId:   claims.UserID,
		CalcType: calcType,
		Currency: body.Currency,
		Inputs:   body.Inputs,
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, simulationToDTO(resp))
}

// SimulationHistory ≡ `GET /simulators/history` (FR-022).
//
// Esta sí va directa al Simulador: es una lectura y no produce evento, así que no hay
// nada que mediar. Los `inputs` y `result` de cada entrada se devuelven como mapas de
// strings decimales, tal como llegan.
func (h *Handler) SimulationHistory(w http.ResponseWriter, r *http.Request) {
	claims, ok := ClaimsFrom(r.Context())
	if !ok {
		h.writeGRPCError(w, r, errUnauthorized)
		return
	}

	resp, err := h.clients.Simulator.ListHistory(r.Context(), &simulatorv1.ListHistoryRequest{
		UserId: claims.UserID,
		Page:   pageRequestFrom(r),
	})
	if err != nil {
		h.writeGRPCError(w, r, err)
		return
	}

	items := make([]SimulationHistoryEntry, 0, len(resp.GetItems()))
	for _, e := range resp.GetItems() {
		items = append(items, historyEntryToDTO(e))
	}
	writeJSON(w, http.StatusOK, pageOf(items, resp.GetPage()))
}
