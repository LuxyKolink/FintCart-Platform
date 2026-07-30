package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"

	"github.com/fintcart/platform/services/orchestrator/internal/server/steps"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Motor de sagas (Constitución Principio VI).
//
// Es la única forma permitida de consistencia multi-servicio en la plataforma: sin
// 2PC y sin bloqueos distribuidos. El motor secuencia pasos hacia delante y, si uno
// falla, ejecuta las compensaciones de los ya completados en orden INVERSO.
//
// Tres propiedades que el motor debe garantizar y que no son opcionales:
//
//  1. **Persistencia del avance.** Cada paso completado se registra en
//     `saga_state` junto con sus eventos, en una sola transacción (D-07). Una saga
//     que solo viviera en memoria dejaría, tras un reinicio, un perfil creado sin
//     credencial y sin nadie que recordara el pendiente.
//  2. **Reanudación.** Al arrancar se recuperan las sagas en `running` o
//     `compensating` y se continúan desde `current_step`. Es la contrapartida de
//     (1): persistir sin reanudar solo produce filas huérfanas.
//  3. **Compensación en orden inverso.** Deshacer en el mismo orden en que se hizo
//     puede violar dependencias entre pasos —anonimizar la credencial antes de
//     revocar las sesiones abre justo la ventana que la saga quería cerrar.

// SagaStatus es la vista de dominio del estado de una saga.
type SagaStatus struct {
	SagaID      string
	SagaType    string
	Status      string
	CurrentStep int32
}

// Engine ejecuta definiciones de saga contra la persistencia.
type Engine struct {
	store  storer.Storer
	logger *slog.Logger
	defs   map[string]steps.Definition
}

// NewEngine registra las definiciones por tipo.
//
// Recibe las definiciones ya construidas (con sus clientes gRPC inyectados) en lugar
// de construirlas: así el motor no conoce ningún servicio participante, que es lo
// que lo mantiene libre de dominio.
func NewEngine(store storer.Storer, logger *slog.Logger, defs ...steps.Definition) *Engine {
	byType := make(map[string]steps.Definition, len(defs))
	for _, d := range defs {
		byType[d.Type] = d
	}
	return &Engine{store: store, logger: logger, defs: byType}
}

// ErrUnknownSagaType se devuelve si se pide un tipo no registrado.
//
// Es un error propio y no un pánico porque el CHECK del esquema y el mapa de
// definiciones pueden desincronizarse —el esquema admite seis tipos— y el fallo
// debe ser un error manejable, no una caída del proceso.
var ErrUnknownSagaType = errors.New("server: tipo de saga desconocido")

// Start crea la saga y la ejecuta hasta completarse o compensarse.
//
// Devuelve el id ANTES de terminar la ejecución en los flujos asíncronos (registro,
// verificación, anonimización): el cliente recibe un `SagaHandle` con el que
// consultar el estado. Los flujos síncronos (calificación, simulación) esperan el
// resultado, y por eso `StartQuizGrading` y `StartSimulation` devuelven datos en
// lugar de un handle.
func (e *Engine) Start(ctx context.Context, sagaType string, payload map[string]any) (uuid.UUID, error) {
	def, ok := e.defs[sagaType]
	if !ok {
		return uuid.Nil, fmt.Errorf("%w: %q", ErrUnknownSagaType, sagaType)
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return uuid.Nil, fmt.Errorf("serializar payload de la saga %s: %w", sagaType, err)
	}

	sagaID, err := e.store.CreateSaga(ctx, sagaType, raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("crear saga %s: %w", sagaType, err)
	}

	// T060 implementa el bucle de ejecución:
	//
	//   for i, step := range def.Steps[st.Step:] {
	//       events, err := step.Do(ctx, st)
	//       if err != nil { → compensar desde i-1 hacia 0; MarkStatus(failed) }
	//       AdvanceSaga(sagaID, i+1, compensacionesPendientes, events)   ← una tx
	//   }
	//   MarkStatus(completed)
	//
	// El detalle que hay que respetar: el contexto que se pasa a `step.Do` NO puede
	// ser el de la petición gRPC en los flujos asíncronos. Si el cliente corta la
	// conexión, la saga quedaría cancelada a medias con pasos ya aplicados —y una
	// saga a medias es exactamente el estado que este motor existe para evitar.
	_ = def
	return sagaID, ErrNotImplemented
}

// Status consulta el estado de una saga (RPC `GetSagaStatus`).
func (e *Engine) Status(ctx context.Context, sagaID uuid.UUID) (SagaStatus, error) {
	row, err := e.store.GetSaga(ctx, sagaID)
	if err != nil {
		return SagaStatus{}, fmt.Errorf("leer estado de la saga %s: %w", sagaID, err)
	}
	return sagaStatusFromRow(row), nil
}

// Resume retoma las sagas que quedaron a medias. Se llama al arrancar.
//
// Un límite de lote acotado y no «todas»: tras una caída prolongada puede haber
// miles de sagas pendientes, y cargarlas de golpe al arrancar convertiría la
// recuperación en una segunda caída.
func (e *Engine) Resume(ctx context.Context, limit int32) error {
	pending, err := e.store.ListResumable(ctx, limit)
	if err != nil {
		return fmt.Errorf("listar sagas reanudables: %w", err)
	}
	for _, row := range pending {
		e.logger.InfoContext(ctx, "saga reanudable encontrada",
			slog.String("saga_id", row.ID.String()),
			slog.String("saga_type", row.SagaType),
			slog.String("status", row.Status),
			slog.Int("current_step", int(row.CurrentStep)),
		)
		// T060: continuar desde `row.CurrentStep`. Una saga en `compensating` retoma
		// las COMPENSACIONES pendientes, no los pasos hacia delante: por eso
		// `compensating` es un estado propio y no un `failed` temprano.
		return ErrNotImplemented
	}
	return nil
}
