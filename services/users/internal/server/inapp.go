package server

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/fintcart/platform/services/users/internal/storer"
)

// Bandeja in-app (FR-023). La posee este servicio y no Notificación: Notificación
// es consumidor puro de RabbitMQ sin superficie gRPC, así que no puede servir
// lecturas al usuario (plan.md N-03, research D-09). Los eventos de actividad
// llegan aquí por el paso `AppendInAppNotification` de la saga.

// InAppNotification es la vista de dominio de una entrada de la bandeja.
//
// `PayloadJSON` se mantiene como texto y no como `map[string]any` porque la forma
// del documento depende del `Type` y la decide quien produce el evento; este
// servicio la almacena y la devuelve sin interpretarla.
type InAppNotification struct {
	ID          string
	Type        string
	PayloadJSON string
	ReadState   string
	CreatedAt   string // RFC-3339, como exige el contrato
}

// InAppPage es una página de la bandeja junto con el total, necesario para que
// `handler` construya el `PageResponse` del contrato.
type InAppPage struct {
	Items []InAppNotification
	Total int64
}

// Tipos de notificación admitidos (FR-023). Coinciden con el CHECK de la tabla,
// pero la validación tiene que ocurrir AQUÍ: si se dejara a PostgreSQL, un tipo
// mal escrito llegaría como violación de constraint, indistinguible de un fallo
// de escritura, y la saga lo reintentaría eternamente en vez de rechazarlo.
const (
	NotifNewArticle        = "nuevo_articulo"
	NotifReminder          = "recordatorio"
	NotifProgressMilestone = "hito_progreso"
	NotifQuizResult        = "resultado_cuestionario"
)

var validNotifTypes = map[string]bool{
	NotifNewArticle:        true,
	NotifReminder:          true,
	NotifProgressMilestone: true,
	NotifQuizResult:        true,
}

// inAppNamespace es el espacio de nombres UUIDv5 de la bandeja.
//
// Es un valor fijo y arbitrario, generado una vez y escrito aquí: lo único que
// importa es que sea estable entre despliegues, porque de él depende que dos
// entregas de la misma notificación produzcan el mismo identificador.
var inAppNamespace = uuid.MustParse("6f1c2f6a-7f9c-4f1e-9f5a-2d3b4c5e6f70")

// AppendInAppNotification añade una entrada a la bandeja.
//
// El identificador se DERIVA del contenido (UUIDv5 sobre usuario + tipo +
// payload) en lugar de generarse al azar, y esa es la decisión importante del
// método. La saga de actividad entrega at-least-once (D-07): una reentrega es
// normal, no excepcional. Con un identificador aleatorio, cada reentrega añadiría
// una copia visible en la bandeja del usuario, y no hay forma de limpiarla
// después porque nada distingue la copia del original.
//
// El contrato NO tiene campo de idempotencia —`InAppNotification` solo lleva
// `user_id`, `type` y `payload_json`—, así que el contenido es lo único
// disponible para deduplicar. La contrapartida es que dos notificaciones
// byte-idénticas para el mismo usuario colapsan en una; para los cuatro tipos
// admitidos eso es lo deseable («aprobaste el cuestionario X» dos veces es ruido,
// no información). Un `event_id` en el contrato lo resolvería mejor y está
// anotado como hueco pendiente.
func (s *Server) AppendInAppNotification(ctx context.Context, userID, notifType, payloadJSON string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	if !validNotifTypes[notifType] {
		return fmt.Errorf("%w: tipo de notificación %q desconocido", ErrInvalidArgument, notifType)
	}
	payload, err := normalizePayload(payloadJSON)
	if err != nil {
		return err
	}

	row := storer.InAppNotificationRow{
		ID:      deriveNotificationID(id, notifType, payload),
		UserID:  id,
		Type:    notifType,
		Payload: payload,
	}
	if err := s.store.AppendInAppNotification(ctx, row); err != nil {
		return fmt.Errorf("añadir notificación in-app: %w", err)
	}
	return nil
}

// normalizePayload exige un OBJETO JSON y lo reserializa en forma canónica.
//
// Dos requisitos, cada uno con su motivo:
//
//   - Objeto y no cualquier JSON válido. La columna es `JSONB` y aceptaría `5` o
//     `"hola"`, pero el frontend lee el payload por clave; un escalar produciría
//     una tarjeta vacía en la bandeja sin que nada fallara.
//   - Reserializado. `encoding/json` ordena las claves de un `map` al serializar,
//     así que dos entregas del mismo evento con las claves en distinto orden dan
//     los mismos bytes — y por tanto el mismo identificador derivado. Sin esto,
//     la deduplicación dependería de que el emisor serializara siempre igual.
func normalizePayload(raw string) ([]byte, error) {
	if raw == "" {
		return []byte("{}"), nil
	}
	var doc map[string]any
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("%w: payload_json no es un objeto JSON: %w", ErrInvalidArgument, err)
	}
	canonical, err := json.Marshal(doc)
	if err != nil {
		return nil, fmt.Errorf("%w: payload_json no es serializable: %w", ErrInvalidArgument, err)
	}
	return canonical, nil
}

// deriveNotificationID calcula el UUIDv5 de la notificación.
//
// Los tres componentes se separan con un byte 0x00, que no puede aparecer dentro
// de un identificador ni de un JSON válido. Concatenarlos sin separador dejaría
// que dos notificaciones distintas produjeran la misma entrada — el tipo y el
// payload podrían «prestarse» caracteres en la frontera— y una de las dos
// desaparecería de la bandeja.
func deriveNotificationID(userID uuid.UUID, notifType string, payload []byte) uuid.UUID {
	seed := make([]byte, 0, len(userID)+len(notifType)+len(payload)+2)
	seed = append(seed, userID[:]...)
	seed = append(seed, 0)
	seed = append(seed, notifType...)
	seed = append(seed, 0)
	seed = append(seed, payload...)
	return uuid.NewSHA1(inAppNamespace, seed)
}

// ListInAppNotifications devuelve la bandeja paginada, más recientes primero.
func (s *Server) ListInAppNotifications(ctx context.Context, userID string, limit, offset int32) (InAppPage, error) {
	id, err := parseUserID(userID)
	if err != nil {
		return InAppPage{}, err
	}
	rows, total, err := s.store.ListInAppNotifications(ctx, id, limit, offset)
	if err != nil {
		return InAppPage{}, fmt.Errorf("listar bandeja in-app: %w", err)
	}
	return inAppPageFromRows(rows, total), nil
}

// MarkNotificationRead marca una entrada como leída.
func (s *Server) MarkNotificationRead(ctx context.Context, userID, notificationID string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	notif, err := parseUserID(notificationID)
	if err != nil {
		return fmt.Errorf("%w: notification_id %q no es un UUID", ErrInvalidArgument, notificationID)
	}
	if err := s.store.MarkNotificationRead(ctx, id, notif); err != nil {
		return fmt.Errorf("marcar notificación como leída: %w", err)
	}
	return nil
}
