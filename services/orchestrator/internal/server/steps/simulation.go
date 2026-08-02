package steps

import (
	"context"
	"fmt"

	simulatorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/simulator/v1"
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
// quiere conservar para auditoría. Si el segundo paso fallara, la simulación queda
// hecha y su evento sigue pendiente en el outbox: se reintenta, y borrar el
// historial para «compensar» destruiría justo lo que FR-022 obliga a guardar.
func SimulationDefinition(c Clients) Definition {
	return Definition{
		Type: storer.SagaSimulacion,
		Steps: []Step{
			{
				Name: "simulator.compute",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					calcType, err := st.Int32(payloadCalcType)
					if err != nil {
						return nil, err
					}
					currency, err := st.String(payloadCurrency)
					if err != nil {
						return nil, err
					}
					// Los `inputs` se pasan TAL CUAL. El Orquestador no los parsea ni
					// comprueba su escala: hacerlo duplicaría la validación del Simulador
					// y crearía dos semánticas del mismo monto, que es como acaban
					// discrepando dos servicios sobre una cifra (Principio VIII +
					// Principio VI).
					inputs, err := st.StringMap(payloadInputs)
					if err != nil {
						return nil, err
					}

					resp, err := c.Simulator.Compute(ctx, &simulatorv1.ComputeRequest{
						UserId:   userID,
						CalcType: simulatorv1.CalcType(calcType),
						Currency: currency,
						Inputs:   inputs,
					})
					if err != nil {
						return nil, fmt.Errorf("ejecutar la simulación de %s: %w", userID, err)
					}

					st.Payload[payloadSimulationID] = resp.GetSimulationId()
					st.Payload[payloadResult] = resp.GetResult()
					st.Payload[payloadComputedAt] = resp.GetComputedAt()
					return nil, nil
				},
				// Sin compensación: no existe RPC para borrar una simulación, y con
				// razón. La fila del historial es lo que acredita que el cálculo ocurrió
				// (FR-022, FR-025); retirarla sería falsificar el registro, no deshacerlo.
				Compensate: nil,
			},
			{
				Name: "emit.simulation_executed",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					userID, err := st.String(payloadUserID)
					if err != nil {
						return nil, err
					}
					simulationID, err := st.String(payloadSimulationID)
					if err != nil {
						return nil, err
					}
					calcType, err := st.Int32(payloadCalcType)
					if err != nil {
						return nil, err
					}

					// El payload lleva el `simulation_id` y el tipo de cálculo, NO los
					// montos ni los resultados. Auditoría no necesita las cifras para
					// acreditar que la simulación ocurrió —para eso está la referencia a
					// la fila del Simulador—, y `audit_log` es append-only: un dato
					// financiero que entre ahí no se puede retirar nunca (FR-031). El
					// titular viaja como `actor_ref` opaco por la misma razón.
					return []Event{{
						Type:       events.EventSimulationExecuted,
						RoutingKey: events.EventSimulationExecuted,
						ActorRef:   userID,
						Payload: map[string]any{
							payloadSimulationID: simulationID,
							// Como NOMBRE y no como el entero del enum: un `2` en el
							// registro de auditoría deja de significar nada el día que
							// alguien reordene el enum, y un log inmutable no admite que
							// se reinterprete su contenido a posteriori.
							payloadCalcType: calcTypeName(calcType),
						},
					}}, nil
				},
				Compensate: nil,
			},
		},
	}
}

// calcTypeName traduce el enum del contrato a su nombre estable.
//
// Se usa el mapa generado desde el propio `.proto`, de modo que un valor nuevo del
// enum aparezca en el registro sin tocar esta función. Un entero desconocido se anota
// tal cual en vez de descartarse: perder la traza de una simulación por no reconocer
// su tipo sería peor que anotar un número.
func calcTypeName(value int32) string {
	if name, ok := simulatorv1.CalcType_name[value]; ok {
		return name
	}
	return fmt.Sprintf("CALC_TYPE_DESCONOCIDO_%d", value)
}
