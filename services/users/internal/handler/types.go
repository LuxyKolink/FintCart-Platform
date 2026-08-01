// Tipos y contratos de la capa de TRANSPORTE del Servicio de Usuarios.
//
// Principio IX: `handler` es la capa más externa. Conoce gRPC, códigos de estado
// y tokens de paginación; no conoce SQL ni reglas de negocio. Su dependencia
// hacia abajo es la interfaz [Service], no el struct `*server.Server`.
package handler

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"strconv"

	"github.com/fintcart/platform/services/users/internal/server"
)

// Service es lo que el transporte necesita de la capa de aplicación.
//
// Se declara aquí, en el CONSUMIDOR, y no en `server` junto al implementador.
// Esa dirección es la que hace útil la interfaz: el transporte enumera lo que
// usa, y si un método deja de necesitarse desaparece de aquí sin tocar la capa de
// abajo. Declararla junto al implementador la convertiría en una copia de la
// lista de métodos de `*server.Server`, que no aporta nada y hay que mantener.
//
// Los tipos que cruzan son de DOMINIO (`server.Profile`, `server.Progress`…),
// nunca proto: la conversión ocurre en `mapping.go` (Principio IX regla 3).
type Service interface {
	CreateProfile(ctx context.Context, userID, email, displayName string) error
	MarkEmailVerified(ctx context.Context, userID string) error
	GetAuthContext(ctx context.Context, userID string) (server.AuthContext, error)
	GetProfile(ctx context.Context, userID string) (server.Profile, error)
	UpdateProfile(ctx context.Context, userID, displayName string, preferences map[string]string) error
	ApplyQuizScore(ctx context.Context, userID, quizID, score string) (server.Progress, error)
	GetProgress(ctx context.Context, userID string) (server.Progress, error)
	RecordArticleView(ctx context.Context, userID, articleID string) error
	AppendInAppNotification(ctx context.Context, userID, notifType, payloadJSON, eventID string) error
	ListInAppNotifications(ctx context.Context, userID string, limit, offset int32) (server.InAppPage, error)
	MarkNotificationRead(ctx context.Context, userID, notificationID string) error
	GetActivityReport(ctx context.Context, userID string) (server.ActivityReport, error)
	AnonymizeProfile(ctx context.Context, userID string) error
}

// Límites de paginación del transporte.
//
// Son de esta capa y no del dominio: acotar el tamaño de página protege al
// servidor de una petición que pida un millón de filas, y eso es una decisión de
// transporte. El dominio no debería tener opinión sobre cuántas notificaciones
// caben en una respuesta gRPC.
const (
	defaultPageSize int32 = 20
	maxPageSize     int32 = 100
)

// errBadPageToken se devuelve cuando el token no lo generó este servicio.
var errBadPageToken = errors.New("handler: page_token inválido")

// decodePageToken traduce el token opaco del contrato a un desplazamiento.
//
// El token es el desplazamiento en base64url y no el número en claro. La
// diferencia no es seguridad —el desplazamiento no es un secreto— sino contrato:
// un token que se ve como `"40"` invita a que un cliente lo construya a mano, y
// entonces el formato queda congelado para siempre. Opaco, se puede cambiar a un
// cursor por `created_at` sin romper a nadie.
func decodePageToken(token string) (int32, error) {
	if token == "" {
		return 0, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return 0, fmt.Errorf("%w: no es base64url", errBadPageToken)
	}
	offset, err := strconv.ParseInt(string(raw), 10, 32)
	// `ParseInt` con `bitSize` 32 ya rechaza lo que no cabe en un int32; el rango
	// se vuelve a comprobar en el punto de la conversión para que la garantía sea
	// visible ahí y no dependa de recordar el tercer argumento de la línea anterior.
	if err != nil || offset < 0 || offset > math.MaxInt32 {
		return 0, fmt.Errorf("%w: desplazamiento no válido", errBadPageToken)
	}
	return int32(offset), nil
}

// encodePageToken produce el token de la página SIGUIENTE, o "" si no hay más.
//
// Devolver "" cuando la página actual agota el total es lo que permite al cliente
// parar sin hacer una petición extra que devuelva una lista vacía.
func encodePageToken(offset, pageSize int32, total int64) string {
	next := int64(offset) + int64(pageSize)
	if next >= total {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(next, 10)))
}

// clampPageSize aplica el tamaño por defecto y el máximo.
func clampPageSize(requested int32) int32 {
	switch {
	case requested <= 0:
		return defaultPageSize
	case requested > maxPageSize:
		return maxPageSize
	default:
		return requested
	}
}
