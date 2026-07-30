package steps

import (
	"context"

	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Simulación MEDIADA (research D-03, FR-025, SC-006).
//
// Secuencia: `Simulator.Compute` → publicar `simulation.executed` para Auditoría.
//
// Por qué el Orquestador está en medio de algo que toca un solo servicio: **el
// Simulador NO es productor de eventos** (D-03, y el catálogo lo declara
// explícitamente). Las simulaciones tienen que auditarse, y el único productor
// autorizado que puede emitir en su nombre es el Orquestador. La alternativa
// —convertir al Simulador en productor— añadiría RabbitMQ a un servicio que solo
// calcula, y la constitución acota deliberadamente quién publica (Principio V).
//
// Es la más corta de las cinco y no tiene compensaciones: calcular no deja efecto
// que deshacer más allá de la fila de historial, que es precisamente lo que se
// quiere conservar para auditoría.
func SimulationDefinition(c Clients) Definition {
	return Definition{
		Type: storer.SagaSimulacion,
		Steps: []Step{
			{
				Name: "simulator.compute",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					// T129: `c.Simulator.Compute` con `inputs` como mapa de strings
					// decimales. El Orquestador NO parsea esos valores ni comprueba su
					// escala: los pasa tal cual. Parsearlos aquí duplicaría la validación
					// del Simulador y crearía dos semánticas de un mismo monto
					// (Principio VIII + Principio VI).
					_, _ = c, st
					return nil, ErrNotImplemented
				},
				Compensate: nil,
			},
			{
				Name: "emit.simulation_executed",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					_ = st
					return []Event{{
						Type:       events.EventSimulationExecuted,
						RoutingKey: events.EventSimulationExecuted,
						// T129: el payload lleva el `simulation_id` y el tipo de cálculo,
						// no los montos. Auditoría no necesita las cifras para acreditar
						// que la simulación ocurrió, y un `audit_log` es append-only: un
						// dato financiero que entre ahí no se puede retirar (FR-031).
						Payload: nil,
					}}, ErrNotImplemented
				},
				Compensate: nil,
			},
		},
	}
}
