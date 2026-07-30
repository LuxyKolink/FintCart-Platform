// Capa de TRANSPORTE del API Gateway — y la única capa que tiene.
//
// plan.md N-01: el Gateway no tiene `server` ni `storer` porque no posee dominio ni
// base de datos. Es transporte puro (`handler`) más clientes salientes
// (`grpcclient`) y rate limiting (`ratelimit`). Es una «capa degenerada legítima»
// del Principio IX, no un atajo.
//
// La consecuencia práctica: si en algún archivo de este paquete aparece una decisión
// de negocio —qué puntaje aprueba, qué campos son obligatorios más allá de su
// presencia, cómo se calcula algo—, está en el servicio equivocado. Lo único que el
// Gateway decide por sí mismo es lo que le corresponde como borde: autenticación,
// autorización por rol, límites de tasa y la forma de la representación REST.
package handler

import (
	"log/slog"

	"github.com/fintcart/platform/services/api-gateway/internal/grpcclient"
)

// Handler atiende el borde REST traduciendo a gRPC.
type Handler struct {
	clients *grpcclient.Clients
	logger  *slog.Logger
}

// New construye el handler. Recibe los clientes ya conectados desde
// `cmd/gateway/main.go` (Principio X: la configuración se lee en el entrypoint).
func New(clients *grpcclient.Clients, logger *slog.Logger) *Handler {
	return &Handler{clients: clients, logger: logger}
}
