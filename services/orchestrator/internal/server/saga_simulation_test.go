package server

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	simulatorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/simulator/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/server/steps"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Prueba de integración de la Saga de SIMULACIÓN (T111, research D-03).
//
// Esta saga existe por una razón que no es de consistencia sino de GOBIERNO: el
// Simulador no es productor de eventos (Principio V), pero las simulaciones tienen
// que auditarse (FR-025, SC-006). El Orquestador se pone en medio de una operación
// que toca un solo servicio únicamente para poder emitir el evento en su nombre.
//
// De ahí lo que se comprueba aquí: que el evento se emite, que lo hace DESPUÉS del
// cálculo, que no arrastra montos al registro inmutable y que un fallo no borra el
// historial. Eso último es lo contrario de lo que haría una compensación ingenua.

const simUser = "22222222-2222-4222-8222-222222222222"

// fakeSimulator reproduce lo que el Simulador real hace con los `inputs`: los
// devuelve calculados como cadenas decimales y NUNCA como números.
type fakeSimulator struct {
	simulatorv1.SimulatorServiceClient

	requests []*simulatorv1.ComputeRequest
	result   map[string]string
	err      error
}

func (f *fakeSimulator) Compute(
	_ context.Context, req *simulatorv1.ComputeRequest, _ ...grpc.CallOption,
) (*simulatorv1.ComputeResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	f.requests = append(f.requests, req)
	return &simulatorv1.ComputeResponse{
		SimulationId: "sim-1",
		Result:       f.result,
		ComputedAt:   "2026-08-01T12:00:00Z",
	}, nil
}

func newSimulationEngine(store storer.Storer, sim *fakeSimulator) *Engine {
	return newTestEngine(store, steps.SimulationDefinition(steps.Clients{Simulator: sim}))
}

func creditInputs() map[string]string {
	return map[string]string{
		"monto":      "12000000.00",
		"tasa_anual": "0.24",
		"meses":      "24",
	}
}

func runSimulation(t *testing.T, engine *Engine, inputs map[string]string) (Simulation, error) {
	t.Helper()
	return New(engine).StartSimulation(context.Background(), simUser,
		int32(simulatorv1.CalcType_CALC_TYPE_CREDITO), "COP", inputs)
}

// ── camino feliz ────────────────────────────────────────────────────────────

func TestSimulationSagaComputesAndAudits(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	sim := &fakeSimulator{result: map[string]string{
		"cuota_mensual": "634514.43",
		"total_pagado":  "15228346.32",
	}}

	out, err := runSimulation(t, newSimulationEngine(store, sim), creditInputs())
	require.NoError(t, err)

	require.Equal(t, "sim-1", out.SimulationID)
	require.Equal(t, "634514.43", out.Result["cuota_mensual"])

	// El evento existe: es la única razón por la que esta saga está aquí. Sin él, la
	// llamada podría ir del Gateway al Simulador directamente y FR-025 quedaría sin
	// cumplir en silencio.
	require.Len(t, store.events, 1)
	require.Equal(t, events.EventSimulationExecuted, store.events[0].EventType)
	// El titular viaja en el sobre como `actor_ref` opaco, que es donde el catálogo lo
	// exige: Auditoría descarta el evento que no lo traiga.
	require.Contains(t, string(store.events[0].Payload), simUser)
	require.Equal(t, storer.StatusCompleted, store.row(t, onlySaga(t, store)).Status)
}

// Los parámetros llegan al Simulador TAL CUAL, sin que el Orquestador los interprete.
//
// Es la comprobación del Principio VIII en este tramo: en el momento en que este
// servicio parseara `"12000000.00"` para «validarlo», existirían dos semánticas del
// mismo monto y acabarían discrepando.
func TestSimulationSagaForwardsTheInputsUntouched(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	sim := &fakeSimulator{result: map[string]string{"cuota_mensual": "1.00"}}

	_, err := runSimulation(t, newSimulationEngine(store, sim), creditInputs())
	require.NoError(t, err)

	require.Len(t, sim.requests, 1)
	require.Equal(t, creditInputs(), sim.requests[0].GetInputs())
	require.Equal(t, "COP", sim.requests[0].GetCurrency())
	require.Equal(t, simulatorv1.CalcType_CALC_TYPE_CREDITO, sim.requests[0].GetCalcType())
}

// TestSimulationSagaKeepsAmountsOutOfTheAuditEvent es la prueba de FR-031.
//
// `audit_log` es append-only: un dato financiero que entre ahí no se puede retirar
// nunca. Auditoría no necesita las cifras para acreditar que la simulación ocurrió
// —le basta la referencia a la fila del Simulador—, así que meterlas sería un riesgo
// permanente a cambio de nada.
func TestSimulationSagaKeepsAmountsOutOfTheAuditEvent(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	sim := &fakeSimulator{result: map[string]string{"cuota_mensual": "634514.43"}}

	_, err := runSimulation(t, newSimulationEngine(store, sim), creditInputs())
	require.NoError(t, err)

	payload := string(store.events[0].Payload)
	require.Contains(t, payload, "sim-1")
	// Ni los resultados ni las entradas: se comprueban las cifras concretas para que
	// la prueba falle si alguien añade el mapa entero «porque puede ser útil».
	require.NotContains(t, payload, "634514.43")
	require.NotContains(t, payload, "12000000.00")
	require.NotContains(t, payload, "0.24")
}

// El tipo de cálculo viaja al registro como NOMBRE, no como el entero del enum.
//
// Un `2` en un log inmutable deja de significar nada el día que alguien reordene el
// enum, y un registro append-only no admite que se reinterprete su contenido después.
func TestSimulationSagaAuditsTheCalcTypeByName(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	sim := &fakeSimulator{result: map[string]string{"cuota_mensual": "1.00"}}

	_, err := runSimulation(t, newSimulationEngine(store, sim), creditInputs())
	require.NoError(t, err)

	require.Contains(t, string(store.events[0].Payload), "CALC_TYPE_CREDITO")
}

// ── camino de fallo ─────────────────────────────────────────────────────────

// Si el cálculo falla no hay nada que auditar: el evento afirma que una simulación
// ocurrió, y emitirlo sobre una que no llegó a ejecutarse ensuciaría el registro con
// un hecho falso que después no se puede corregir.
func TestSimulationSagaEmitsNothingWhenTheComputationFails(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	sim := &fakeSimulator{err: errors.New("el simulador no responde")}

	_, err := runSimulation(t, newSimulationEngine(store, sim), creditInputs())
	require.Error(t, err)

	require.Empty(t, store.events)
	require.Equal(t, storer.StatusFailed, store.row(t, onlySaga(t, store)).Status)
}

// TestSimulationSagaHasNoCompensation fija la decisión de D-03 por construcción.
//
// La tentación sería «compensar» borrando la fila del historial. Sería exactamente lo
// contrario de lo correcto: esa fila es lo que acredita que el cálculo ocurrió
// (FR-022, FR-025), así que retirarla falsificaría el registro en lugar de deshacerlo.
func TestSimulationSagaHasNoCompensation(t *testing.T) {
	t.Parallel()
	def := steps.SimulationDefinition(steps.Clients{})

	require.Len(t, def.Steps, 2)
	for _, step := range def.Steps {
		require.Nil(t, step.Compensate, "el paso %q no debe compensar (D-03)", step.Name)
	}
}

// Un rechazo del Simulador —un monto no canónico, un plazo irrazonable— llega al
// borde como error del CLIENTE y no como un 500.
//
// Sin la traducción, quien envía un parámetro mal formado vería «error interno» y lo
// reintentaría indefinidamente en lugar de corregirlo.
func TestSimulationSagaTranslatesARejectedInput(t *testing.T) {
	t.Parallel()
	sim := &fakeSimulator{
		err: status.Error(codes.InvalidArgument, "meses excede el máximo admitido"),
	}

	_, err := runSimulation(t, newSimulationEngine(newMemStore(), sim), creditInputs())
	require.ErrorIs(t, err, ErrInvalidArgument)
}

// Y lo que no se propaga: un Simulador caído sigue siendo un fallo interno.
func TestSimulationSagaKeepsAnUnavailableSimulatorInternal(t *testing.T) {
	t.Parallel()
	sim := &fakeSimulator{err: status.Error(codes.Unavailable, "simulator no responde")}

	_, err := runSimulation(t, newSimulationEngine(newMemStore(), sim), creditInputs())
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrInvalidArgument)
}

// Un mapa de entradas vacío NO se rechaza aquí: qué parámetros necesita cada
// calculadora lo decide el Simulador, y una segunda lista en este servicio acabaría
// discrepando de la suya (Principio VI).
func TestSimulationSagaDoesNotValidateTheInputs(t *testing.T) {
	t.Parallel()
	sim := &fakeSimulator{result: map[string]string{"balance": "0"}}

	_, err := runSimulation(t, newSimulationEngine(newMemStore(), sim), nil)
	require.NoError(t, err)
	require.Empty(t, sim.requests[0].GetInputs())
}
