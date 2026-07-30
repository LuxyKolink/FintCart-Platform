// Capa de persistencia del Servicio de Auditoría (Principio IX).
//
// Es la capa degenerada más extrema de la plataforma, y con razón: el servicio SOLO
// inserta. No hay `UPDATE`, no hay `DELETE`, no hay `execTx` para escrituras
// multi-tabla —porque hay una sola tabla y una sola operación.
//
// La inmutabilidad no se defiende desde aquí. La migración revoca `UPDATE`, `DELETE`
// y `TRUNCATE` sobre `audit_log` y sus particiones, de modo que un bug en este
// código no puede alterar el histórico (FR-025/FR-031). Lo que este archivo aporta
// es que no exista ni la posibilidad de intentarlo: la interfaz no declara ningún
// método que modifique.
package storer

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

// Centinelas de la capa de persistencia.
var (
	// ErrConflict cubre las violaciones de CHECK del esquema (`result` distinto de
	// success/failure, `operation` en blanco).
	ErrConflict = errors.New("storer: conflicto con el estado actual")
	// ErrNotImplemented marca lo que llega con T063.
	ErrNotImplemented = errors.New("storer: no implementado")
)

// wrap añade la operación conservando la causa (Principio XI regla 6).
func wrap(op string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("storer: %s: %w", op, err)
}

// EntryRow ≡ tabla `audit_log`.
//
// `ActorRef` es un UUID OPACO y no el identificador del usuario: sobrevive a la
// anonimización del titular y no permite re-identificarlo (FR-030). La saga de
// anonimización nunca toca esta tabla, así que este campo es lo único que queda para
// correlacionar acciones de una cuenta ya suprimida.
//
// `Context` son bytes crudos de JSONB y debe estar despersonalizado. La razón es
// operativa, no formal: la tabla es append-only, así que un dato personal que entre
// aquí NO se puede retirar después. Un evento de anonimización que incluyera el
// correo que se acaba de borrar convertiría el propio registro de la supresión en una
// violación de ella.
//
// `OccurredAt` (cuándo pasó, lo dice el productor) y `RecordedAt` (cuándo se
// registró, lo pone la base) son distintos a propósito: la diferencia entre ambos es
// el retraso de la cola, y es un dato de auditoría en sí mismo.
type EntryRow struct {
	ID         uuid.UUID `db:"id"`
	ActorRef   uuid.UUID `db:"actor_ref"`
	Operation  string    `db:"operation"`
	Context    []byte    `db:"context"`
	Result     string    `db:"result"`
	OccurredAt time.Time `db:"occurred_at"`
	RecordedAt time.Time `db:"recorded_at"`
}

// Valores admitidos por el CHECK `audit_log_result_valid`.
const (
	ResultSuccess = "success"
	ResultFailure = "failure"
)

// Storer es el contrato de persistencia: una sola operación, y de escritura.
//
// No hay métodos de lectura. Las consultas regulatorias existen —los índices
// `audit_log_actor_idx` y `audit_log_operation_idx` están para ellas—, pero se hacen
// contra la base directamente por parte de quien audita, no a través de este
// servicio: Auditoría es un consumidor puro sin superficie gRPC (Principio V,
// plan.md N-01), así que no tiene por dónde servir una lectura.
type Storer interface {
	// Append inserta una entrada. Es la ÚNICA operación del servicio.
	Append(ctx context.Context, e EntryRow) error
}

// PostgresStorer es la implementación sobre `audit_db`.
type PostgresStorer struct {
	db *sqlx.DB
}

// NewPostgresStorer construye el storer sobre un pool ya abierto (Principio X).
func NewPostgresStorer(db *sqlx.DB) *PostgresStorer {
	return &PostgresStorer{db: db}
}

// appendQuery es la única sentencia del servicio.
//
// `id` lo aporta el productor (es el `event_id` del sobre), no la base, y el
// `ON CONFLICT DO NOTHING` es lo que convierte eso en idempotencia: el outbox del
// Orquestador entrega AT-LEAST-ONCE (research D-07), así que un evento repetido es
// normal y debe quedar sin efecto en lugar de duplicar la entrada.
//
// `recorded_at` no se pasa: lo pone el `DEFAULT now()` de la base. Que la marca de
// «cuándo se registró» venga del servidor de base de datos y no del proceso
// consumidor es deliberado — el reloj de un pod puede ir desviado, y en un registro
// con valor probatorio conviene una sola fuente de tiempo.
const appendQuery = `
INSERT INTO audit_log (id, actor_ref, operation, context, result, occurred_at)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (id, occurred_at) DO NOTHING`

// Append inserta la entrada de auditoría.
//
// No usa `RETURNING` ni vuelve a leer nada: Auditoría no necesita saber qué escribió,
// necesita que quede escrito.
func (s *PostgresStorer) Append(ctx context.Context, e EntryRow) error {
	_, err := s.db.ExecContext(ctx, appendQuery,
		e.ID, e.ActorRef, e.Operation, e.Context, e.Result, e.OccurredAt)
	if err != nil {
		return wrap("insertar entrada de auditoría", err)
	}
	return nil
}

// Comprobación en tiempo de compilación del implementador.
var _ Storer = (*PostgresStorer)(nil)
