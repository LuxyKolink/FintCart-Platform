package server

import (
	"context"
	"fmt"
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

// AppendInAppNotification añade una entrada a la bandeja.
func (s *Server) AppendInAppNotification(_ context.Context, userID, notifType, payloadJSON string) error {
	if _, err := parseUserID(userID); err != nil {
		return err
	}
	// T118: validar `notifType` contra los cuatro valores del CHECK de la tabla y
	// que `payloadJSON` sea JSON válido. Las dos validaciones son de dominio y no
	// del storer: si se dejaran al CHECK de PostgreSQL, el error llegaría como una
	// violación de constraint indistinguible de un fallo de escritura.
	_, _ = notifType, payloadJSON
	return ErrNotImplemented
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
