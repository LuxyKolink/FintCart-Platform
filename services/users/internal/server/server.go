// Capa de aplicación del Servicio de Usuarios (Principio IX: la capa intermedia).
//
// Aquí viven las reglas de negocio y los tipos de DOMINIO. Lo que NO vive aquí,
// y es igual de definitorio:
//
//   - No hay SQL. Toda persistencia pasa por la interfaz `storer.Storer`.
//   - No hay tipos proto en las firmas públicas de esta capa. Los DTO del
//     contrato se convierten en `internal/handler/mapping.go`, y los tipos de fila
//     en `mapping.go` de este paquete (Principio IX regla 3).
//   - No hay `net/http`, ni códigos de estado gRPC, ni cabeceras: eso es
//     transporte y pertenece a `handler`.
//
// La consecuencia práctica es que estas reglas se pueden probar con un doble de
// `Storer` y sin levantar un servidor gRPC ni una base de datos.
package server

import (
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/fintcart/platform/services/users/internal/storer"
)

// Errores de dominio de esta capa. `handler` los traduce a códigos gRPC; nadie
// más los interpreta.
var (
	// ErrInvalidArgument: la entrada no es utilizable (UUID mal formado, campo
	// obligatorio vacío, puntaje fuera del rango de la columna).
	ErrInvalidArgument = errors.New("server: argumento inválido")

	// ErrNotImplemented marca los métodos del esqueleto (T024) cuyo cuerpo llega
	// con las tareas de implementación. Es explícito a propósito: un stub que
	// devolviera el valor cero y `nil` se vería exactamente igual que un dato
	// legítimo, y el fallo aparecería como «el progreso siempre es 0» en lugar de
	// como un error.
	ErrNotImplemented = errors.New("server: no implementado")
)

// Centinelas de persistencia que SÍ forman parte del contrato de esta capa, para
// que `handler` no tenga que importar `storer`.
//
// Saltarse una capa —aunque sea hacia abajo— acoplaría el transporte a la
// persistencia: el día que «no encontrado» deje de venir de la base de datos y
// venga de una llamada gRPC saliente, `handler` no tendría que cambiar. Son alias
// y no copias para que `errors.Is` siga funcionando sobre la cadena `%w` completa.
var (
	ErrNotFound = storer.ErrNotFound
	ErrConflict = storer.ErrConflict
)

// Server implementa las reglas de los casos de uso de `UsersService`.
//
// Sus dependencias entran por constructor y son interfaces, no structs
// concretos (Principio IX: «inyección por constructor»). `attempts` y `sims` son
// los dos puertos SALIENTES que exige plan.md N-02: `GetActivityReport` necesita
// `quizzes_attempted` (dominio de Aprendizaje) y `simulations_run` (dominio del
// Simulador), y el Principio III prohíbe leerlos de sus bases de datos, así que
// se piden por gRPC.
type Server struct {
	store    storer.Storer
	attempts AttemptCounter
	sims     SimulationCounter
}

// New ensambla la capa de aplicación.
//
// No abre conexiones ni lee variables de entorno: recibe todo ya construido
// desde `cmd/users/main.go` (Principio X).
func New(store storer.Storer, attempts AttemptCounter, sims SimulationCounter) *Server {
	return &Server{store: store, attempts: attempts, sims: sims}
}

// parseUserID convierte el identificador opaco del contrato en un UUID.
//
// Los identificadores viajan como `string` entre servicios porque son opacos
// (Principio III: no hay claves foráneas entre bases, la correlación es por UUID),
// pero dentro del servicio son `uuid.UUID`: un `string` sin validar acabaría
// llegando al SQL, donde el error se convertiría en un fallo del driver a mitad de
// una transacción en lugar de un rechazo limpio en la frontera.
func parseUserID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%w: user_id %q no es un UUID", ErrInvalidArgument, raw)
	}
	return id, nil
}
