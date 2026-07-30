// Mapeo explícito de la capa de aplicación del Orquestador (Principio IX regla 3).
//
// Es el archivo más corto de los cinco servicios Go, y eso es esperable: el
// Orquestador no tiene dominio propio (Principio VI), así que la única frontera que
// traduce es la del estado de saga —lo único que sí posee.
package server

import (
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// sagaStatusFromRow convierte la fila de `saga_state` en la vista de dominio.
//
// Deja fuera `payload`, `compensations` y `last_error` a propósito. Los dos primeros
// son estado interno del motor: exponerlos por el RPC de consulta invitaría a que un
// cliente los leyera y acabara dependiendo de la representación interna de las
// sagas. `last_error` queda fuera por otra razón — puede contener el detalle de un
// fallo de un servicio interno (nombres de host, mensajes del driver), y el
// contrato `SagaStatus` no declara un campo para él.
func sagaStatusFromRow(r storer.SagaRow) SagaStatus {
	return SagaStatus{
		SagaID:      r.ID.String(),
		SagaType:    r.SagaType,
		Status:      r.Status,
		CurrentStep: r.CurrentStep,
	}
}
