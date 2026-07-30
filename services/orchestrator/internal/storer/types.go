// Tipos de FILA del Orquestador (Principio IX regla 3).
//
// Nótese lo que este archivo NO contiene: ningún dato de negocio de otro bounded
// context. El Principio VI prohíbe lógica de dominio aquí, y `orchestrator_db`
// respeta la misma frontera — solo guarda el ESTADO DE SECUENCIACIÓN de las sagas
// y el outbox de eventos. El `payload` de una saga es un JSONB opaco que el
// Orquestador transporta entre pasos sin interpretarlo; si empezara a leerlo campo
// por campo para decidir, habría adquirido lógica de dominio por la puerta de atrás.
package storer

import (
	"time"

	"github.com/google/uuid"
)

// Tipos de saga, replicados del CHECK `saga_state_type_valid`.
//
// Son los nombres en español del esquema y no una traducción: si el código usara
// `"registration"` y la columna espera `"registro"`, la escritura fallaría por
// constraint en tiempo de ejecución. La lista aquí es la que manda.
const (
	SagaRegistro          = "registro"
	SagaVerificacionEmail = "verificacion_email"
	SagaCalificacion      = "calificacion"
	SagaSimulacion        = "simulacion"
	SagaActividad         = "actividad"
	SagaAnonimizacion     = "anonimizacion"
)

// Estados de saga, replicados del CHECK `saga_state_status_valid`.
//
// `compensating` es un estado propio y no un `failed` temprano, y la distinción es
// la que hace reanudable el motor: una saga que murió a mitad de sus
// compensaciones tiene que retomarlas, no volver a intentar los pasos hacia
// delante.
const (
	StatusRunning      = "running"
	StatusCompleted    = "completed"
	StatusCompensating = "compensating"
	StatusFailed       = "failed"
)

// SagaRow ≡ tabla `saga_state`.
//
// `Payload` y `Compensations` son bytes crudos de JSONB. `Compensations` es una
// lista de las compensaciones PENDIENTES, acumulada a medida que los pasos
// avanzan: el motor la necesita para saber qué deshacer, y tiene que sobrevivir a
// un reinicio del proceso — si viviera solo en memoria, un fallo del Orquestador
// dejaría un perfil creado sin credencial y sin nadie que lo recordara.
type SagaRow struct {
	ID            uuid.UUID `db:"id"`
	SagaType      string    `db:"saga_type"`
	Status        string    `db:"status"`
	CurrentStep   int32     `db:"current_step"`
	Payload       []byte    `db:"payload"`
	Compensations []byte    `db:"compensations"`
	LastError     *string   `db:"last_error"`
	CreatedAt     time.Time `db:"created_at"`
	UpdatedAt     time.Time `db:"updated_at"`
}

// OutboxRow ≡ tabla `event_outbox` (research D-07).
//
// `SagaID` es nullable en el esquema; aquí es puntero por eso. Un evento sin saga
// asociada es legítimo (una publicación suelta), y colapsar el NULL a
// `uuid.Nil` haría que ese caso pareciera apuntar a una saga inexistente.
//
// `PublishedAt` nulo ES la definición de «pendiente»: el índice parcial
// `event_outbox_pending_idx` se apoya en ello, así que no se sustituye por un
// booleano redundante que pudiera contradecirlo.
type OutboxRow struct {
	ID          uuid.UUID  `db:"id"`
	SagaID      *uuid.UUID `db:"saga_id"`
	EventType   string     `db:"event_type"`
	RoutingKey  string     `db:"routing_key"`
	Payload     []byte     `db:"payload"`
	PublishedAt *time.Time `db:"published_at"`
	Attempts    int32      `db:"attempts"`
	CreatedAt   time.Time  `db:"created_at"`
}
