package handler

import (
	"net/http"
)

// Rutas de simuladores: `/simulators/*`.

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
	// T130: traducir el `{calcType}` de la ruta al enum `fintcart.simulator.v1.CalcType`
	// y llamar a `Orchestrator.StartSimulation`.
	//
	// La traducción del segmento de URL al enum es responsabilidad del borde y hay que
	// hacerla explícita: un valor desconocido debe dar 400 aquí, no un enum cero que el
	// Simulador interprete como el primer tipo de cálculo de la lista.
	h.writeGRPCError(w, r, errNotImplemented)
}

// SimulationHistory ≡ `GET /simulators/history`.
//
// Esta sí va directa al Simulador: es una lectura y no produce evento, así que no hay
// nada que mediar.
func (h *Handler) SimulationHistory(w http.ResponseWriter, r *http.Request) {
	// T130: `Simulator.ListHistory` con el usuario del token y la paginación de la query
	// string. Los `inputs` y `result` de cada entrada se devuelven como mapas de
	// strings decimales, tal como llegan.
	h.writeGRPCError(w, r, errNotImplemented)
}
