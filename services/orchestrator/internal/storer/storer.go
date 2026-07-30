// Capa de persistencia del Orquestador (Principio IX).
//
// La interfaz está diseñada alrededor de una única garantía, la de research D-07:
// **el avance de una saga y los eventos que ese avance produce se escriben en la
// MISMA transacción**. De ahí que [Storer.AdvanceSaga] reciba los eventos como
// parámetro en lugar de existir un `EnqueueEvent` separado.
//
// La alternativa —avanzar la saga y luego encolar el evento— tiene una ventana
// entre las dos escrituras. Si el proceso muere ahí, la saga queda avanzada y el
// evento no existe: Auditoría nunca registra la operación (FR-025) y Notificación
// nunca envía el correo, sin que nada quede marcado como pendiente. La firma hace
// ese error imposible de escribir.
package storer

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// Centinelas de la capa de persistencia.
var (
	ErrNotFound = errors.New("storer: no encontrado")
	ErrConflict = errors.New("storer: conflicto con el estado actual")
	// ErrNotImplemented marca los métodos del esqueleto (T026).
	ErrNotImplemented = errors.New("storer: no implementado")
)

// wrap añade la operación conservando la causa (Principio XI regla 6).
func wrap(op string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("storer: %s: %w", op, err)
}

// Storer es el contrato de persistencia del estado de sagas y del outbox.
type Storer interface {
	// CreateSaga inserta la saga en `running` en el paso 0 y devuelve su id.
	CreateSaga(ctx context.Context, sagaType string, payload []byte) (uuid.UUID, error)

	// GetSaga lee el estado actual (lo consulta `GetSagaStatus`).
	GetSaga(ctx context.Context, sagaID uuid.UUID) (SagaRow, error)

	// AdvanceSaga registra el avance a `step`, actualiza las compensaciones
	// pendientes y encola los eventos producidos, TODO en una transacción (D-07).
	AdvanceSaga(ctx context.Context, sagaID uuid.UUID, step int32, compensations []byte, events []OutboxRow) error

	// MarkStatus mueve la saga a un estado terminal o a `compensating`,
	// registrando el motivo en `last_error` cuando lo haya.
	MarkStatus(ctx context.Context, sagaID uuid.UUID, status string, lastErr error) error

	// ListResumable devuelve las sagas que quedaron a medias (`running` o
	// `compensating`) para retomarlas al arrancar.
	//
	// Existe porque una saga interrumpida no se arregla sola: sin reanudación, un
	// reinicio en mitad del registro deja una credencial sin perfil de forma
	// permanente. `limit` acota el lote para no traer un backlog entero de golpe.
	ListResumable(ctx context.Context, limit int32) ([]SagaRow, error)

	// ── outbox (lo consume `internal/outbox`) ────────────────────────────────

	// ListPendingEvents devuelve los eventos sin publicar en orden de creación.
	ListPendingEvents(ctx context.Context, limit int32) ([]OutboxRow, error)

	// MarkEventPublished sella el evento con la hora de publicación.
	MarkEventPublished(ctx context.Context, eventID uuid.UUID) error

	// IncrementEventAttempts registra un intento fallido de publicación.
	//
	// El contador se guarda en la fila y no en memoria del publicador para que un
	// evento que falla de forma sistemática sea visible en la base —y por tanto
	// alertable— en lugar de reiniciar su cuenta en cada despliegue.
	IncrementEventAttempts(ctx context.Context, eventID uuid.UUID, cause error) error
}

// Comprobación en tiempo de compilación del implementador de PostgreSQL.
var _ Storer = (*PostgresStorer)(nil)
