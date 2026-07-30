// Pasos de saga: el vocabulario que comparten el motor y las definiciones.
//
// Este paquete existe para romper un ciclo de importación. El motor
// (`internal/server/saga.go`) ejecuta pasos, y cada definición de saga declara los
// suyos; si los tipos vivieran en `server`, los archivos de `steps/` tendrían que
// importarlo y `server` tendría que importar `steps/`. Con los tipos aquí, la
// dependencia va en un solo sentido: `server` → `steps`.
//
// **Principio VI**: nada de esto contiene lógica de dominio. Un paso invoca un RPC
// y, si hace falta, sabe cómo deshacerlo. No calcula puntajes, no valida reglas de
// negocio y no interpreta el resultado más allá de decidir si el paso tuvo éxito.
// Ese es el límite entre orquestar y decidir.
//
// Los pasos usan directamente los clientes gRPC generados en lugar de puertos
// estrechos, y es una excepción DELIBERADA al patrón del resto de la plataforma: el
// Orquestador no tiene dominio propio, así que un puerto por RPC sería una capa de
// indirección que no traduce nada. Los clientes generados ya son interfaces, de
// modo que los dobles de prueba siguen siendo posibles (T071, T072).
package steps

import (
	"context"
	"errors"

	authv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/auth/v1"
	learningv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/learning/v1"
	simulatorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/simulator/v1"
	usersv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/users/v1"
)

// ErrNotImplemented marca los pasos del esqueleto (T026). Las implementaciones
// llegan con T060 y las tareas por historia.
var ErrNotImplemented = errors.New("steps: no implementado")

// Clients agrupa los clientes gRPC de los servicios participantes.
//
// `cmd/orchestrator/main.go` los construye con las direcciones de entorno y los
// pasa aquí (Principio X regla 3: descubrimiento por hostname). No incluye
// Auditoría ni Notificación: son consumidores puros y no exponen gRPC
// (Principio V, plan.md N-01), así que se les llega por evento, nunca por llamada.
type Clients struct {
	Users     usersv1.UsersServiceClient
	Auth      authv1.AuthServiceClient
	Learning  learningv1.LearningServiceClient
	Simulator simulatorv1.SimulatorServiceClient
}

// State es el estado vivo de una saga en ejecución.
//
// `Payload` es el documento opaco que viaja entre pasos: cada paso escribe en él lo
// que el siguiente necesita (el `user_id` recién creado, el `attempt_id` de la
// calificación). Se persiste en `saga_state.payload` en cada avance, y por eso una
// saga puede reanudarse tras un reinicio — sin persistirlo, la reanudación no
// tendría con qué continuar.
//
// Es `map[string]any` y no un struct por saga porque el motor no debe conocer la
// forma del payload de cada flujo; en el momento en que lo conociera, tendría
// lógica de dominio (Principio VI).
type State struct {
	SagaID  string
	Type    string
	Step    int32
	Payload map[string]any
}

// Event es un evento de dominio producido por un paso.
//
// El paso lo DEVUELVE en lugar de publicarlo: la publicación la hace el motor,
// dentro de la misma transacción que el avance de la saga (research D-07). Si un
// paso publicara por su cuenta, se perdería esa atomicidad y con ella la garantía
// de que un avance confirmado tiene su evento registrado.
type Event struct {
	Type       string
	RoutingKey string
	Payload    map[string]any
}

// Step es un paso con su compensación.
//
// Se modela como un struct de funciones y no como una interfaz por paso: hay
// alrededor de veinte pasos en total y una interfaz obligaría a un tipo con dos
// métodos por cada uno, la mayoría de una línea. Lo que importa del paso es su
// nombre y sus dos funciones, y así es exactamente lo que se declara.
type Step struct {
	// Name identifica el paso en el log y en `saga_state.compensations`. Se
	// persiste, así que cambiarlo rompe la reanudación de las sagas en vuelo.
	Name string

	// Do ejecuta el paso hacia delante. Devuelve los eventos que el avance produce.
	Do func(ctx context.Context, st *State) ([]Event, error)

	// Compensate deshace el paso. Puede ser nil cuando el paso no deja efecto que
	// deshacer —una lectura, o una escritura idempotente y monótona como
	// `Users.ApplyQuizScore` (D-07)—, y ese nil es información, no un descuido: el
	// motor lo salta y el log lo registra como «sin compensación necesaria».
	//
	// DEBE ser idempotente. El motor puede reintentarla tras un reinicio, y una
	// compensación que reste puntos dos veces es peor que no compensar.
	Compensate func(ctx context.Context, st *State) error
}

// Definition es una saga completa: su tipo y sus pasos en orden.
type Definition struct {
	// Type debe ser uno de los valores del CHECK `saga_state_type_valid`.
	Type  string
	Steps []Step
}
