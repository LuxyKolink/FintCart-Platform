package steps

import (
	"context"
	"fmt"

	simulatorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/simulator/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Curaduría de una calculadora (T115, FR-053).
//
// Secuencia: `Simulator.ApproveCalculator` → `Simulator.GetCalculator` → publicar
// `calculator.published` para Auditoría.
//
// ## Por qué el Orquestador está en medio de algo que toca un solo servicio
//
// El Simulador NO es productor de eventos (Principio V), y una calculadora que aparece en el
// catálogo público tiene que dejar rastro de quién la aprobó y cuándo. Es exactamente el mismo
// motivo que puso al Orquestador en medio de `Compute` (D-03), y la alternativa —convertir al
// Simulador en productor— añadiría RabbitMQ a un servicio que solo calcula.
//
// ## Por qué hay un SEGUNDO paso que solo lee
//
// La aprobación publica la versión VIGENTE, y cuál es esa versión no lo sabe quien aprueba:
// `ApproveCalculator` devuelve `OpResult` y no lleva la versión. Se pregunta después, y no
// antes, porque la respuesta tiene que ser la que quedó publicada: preguntar antes dejaría una
// ventana en la que el autor escribe otra versión y el evento anunciaría una que no es.
//
// Es una LECTURA, así que no lleva compensación: no deja efecto que deshacer aunque el paso
// siguiente falle. Si el evento no llegara a publicarse, la aprobación queda hecha y su evento
// pendiente en el outbox, que es lo correcto — publicar es lo que no se puede perder.
func CurationDefinition(c Clients) Definition {
	return Definition{
		Type: storer.SagaCuraduria,
		Steps: []Step{
			{
				Name: "simulator.approve_calculator",
				Do: func(ctx context.Context, st *State) ([]Event, error) {
					calculatorID, err := st.String(payloadCalculatorID)
					if err != nil {
						return nil, err
					}
					coordinatorID, err := st.String(payloadCoordinatorID)
					if err != nil {
						return nil, err
					}

					_, err = c.Simulator.ApproveCalculator(ctx, &simulatorv1.ApproveCalculatorRequest{
						CalculatorId:  calculatorID,
						CoordinatorId: coordinatorID,
					})
					if err != nil {
						return nil, fmt.Errorf("aprobar la calculadora %s: %w", calculatorID, err)
					}

					// El actor de la lectura es el COORDINADOR y no el autor: lo que hay que leer
					// es lo que acaba de publicarse, y el autor —siendo el autor— vería su
					// borrador en lugar de la versión aprobada. Es el mismo par de vistas que
					// separa `published_version` de `version`.
					publicada, err := c.Simulator.GetCalculator(ctx, &simulatorv1.CalculatorRef{
						CalculatorId: calculatorID,
						ActorId:      coordinatorID,
					})
					if err != nil {
						return nil, fmt.Errorf("leer la calculadora %s aprobada: %w", calculatorID, err)
					}

					st.Payload[payloadCalculatorVersion] = publicada.GetVersion()
					st.Payload[payloadOwnerRef] = publicada.GetOwnerId()
					st.Payload[payloadApproverRef] = coordinatorID
					return nil, nil
				},
				// Sin compensación: deshacer una aprobación es publicar otra versión, y no
				// existe tal RPC. Devolver la calculadora a `en_revision` sería retirar del
				// catálogo contenido que un coordinador aprobó — la decisión que el rechazo de
				// un borrador ya toma, y solo cuando alguien la toma.
				Compensate: nil,
			},
			{
				Name: "emit.calculator_published",
				Do: func(_ context.Context, st *State) ([]Event, error) {
					calculatorID, err := st.String(payloadCalculatorID)
					if err != nil {
						return nil, err
					}
					version, err := st.Int32(payloadCalculatorVersion)
					if err != nil {
						return nil, err
					}
					ownerRef, err := st.String(payloadOwnerRef)
					if err != nil {
						return nil, err
					}
					approverRef, err := st.String(payloadApproverRef)
					if err != nil {
						return nil, err
					}

					// El payload es el que fija `events-catalog-delta.md`: la calculadora, la
					// versión aprobada y los dos identificadores OPACOS. Nada más — el nombre y
					// la definición no hacen falta para acreditar la aprobación, y `audit_log` es
					// append-only: lo que entre ahí no se puede retirar.
					//
					// Los dos actores van juntos a propósito, y no solo el aprobador: FR-053 exige
					// que sean distintos, y un registro que solo guardara uno obligaría a cruzar
					// tablas para comprobar la separación de autoría que este evento acredita.
					return []Event{{
						Type:       events.EventCalculatorPublished,
						RoutingKey: events.EventCalculatorPublished,
						ActorRef:   approverRef,
						Payload: map[string]any{
							payloadCalculatorID: calculatorID,
							eventKeyVersion:     version,
							eventKeyOwnerRef:    ownerRef,
							eventKeyApproverRef: approverRef,
						},
					}}, nil
				},
				Compensate: nil,
			},
		},
	}
}
