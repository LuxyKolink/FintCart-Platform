// Convención de errores de la capa de persistencia (Principio XI regla 6:
// «errores envueltos con causa»).
//
// La regla tiene dos mitades y las dos importan:
//
//  1. **La causa se preserva.** Todo error que sale de aquí se envuelve con `%w`,
//     nunca con `%v` ni con un `errors.New` que descarte el original. Un
//     `pq: duplicate key value violates unique constraint` que se pierde deja al
//     que depura sin nada; `errors.Is`/`errors.As` dejan de funcionar y el
//     llamador no puede distinguir un conflicto de una caída de red.
//  2. **El tipo concreto del driver NO cruza la frontera.** La capa `server`
//     razona sobre los centinelas de este archivo, no sobre `*pgconn.PgError`.
//     Así el dominio no queda acoplado al motor y se puede cambiar el driver sin
//     tocar la lógica.
//
// El resultado es un error que se compara por centinela en la capa de arriba y
// que sigue conteniendo el detalle del driver para el log.
package storer

import (
	"errors"
	"fmt"
)

// Centinelas de la capa de persistencia. La capa `server` los traduce a códigos
// gRPC en `internal/server/mapping.go`; ningún otro lugar debe interpretarlos.
var (
	// ErrNotFound: la fila pedida no existe. Corresponde a `sql.ErrNoRows`, que
	// se traduce aquí para que el dominio no importe `database/sql`.
	ErrNotFound = errors.New("storer: no encontrado")

	// ErrConflict: la escritura choca con el estado actual (clave duplicada,
	// violación de CHECK, transición de estado inválida).
	ErrConflict = errors.New("storer: conflicto con el estado actual")

	// ErrNotImplemented: método de esqueleto todavía sin cuerpo. Existe para que
	// el arranque falle de forma explícita y ruidosa en lugar de devolver un cero
	// silencioso que parezca un dato válido. Desaparece cuando las tareas de
	// implementación (T069 y siguientes) llenan cada método.
	ErrNotImplemented = errors.New("storer: no implementado")
)

// wrap añade el nombre de la operación conservando la causa.
//
// El prefijo es la operación y no el archivo porque lo que se necesita al leer
// un log es saber qué se intentaba hacer, no dónde estaba el `return`.
func wrap(op string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("storer: %s: %w", op, err)
}
