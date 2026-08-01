package storer

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
)

// Persistencia de la bandeja in-app (FR-023).
//
// La bandeja la posee ESTE servicio y no Notificación: Notificación es consumidor
// puro de RabbitMQ sin superficie gRPC, así que no podría servir la lectura al
// usuario (plan.md N-03). Las entradas llegan por el paso
// `AppendInAppNotification` de la saga de actividad.

// appendInAppQuery inserta la entrada, o no hace nada si ya está.
//
// El `ON CONFLICT (id) DO NOTHING` es lo que absorbe la reentrega: el
// identificador lo DERIVA la capa `server` del contenido de la notificación, así
// que dos entregas de la misma notificación traen el mismo `id` y la segunda no
// duplica la bandeja. Ver `internal/server/inapp.go` para por qué el
// identificador se deriva y no se genera al azar.
const appendInAppQuery = `
INSERT INTO inapp_notifications (id, user_id, type, payload)
VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO NOTHING`

func (s *PostgresStorer) AppendInAppNotification(ctx context.Context, n InAppNotificationRow) error {
	if _, err := s.db.ExecContext(ctx, appendInAppQuery, n.ID, n.UserID, n.Type, n.Payload); err != nil {
		return classify("añadir notificación in-app", err)
	}
	return nil
}

// listInAppQuery pagina la bandeja, más recientes primero.
//
// El desempate por `id` no es cosmético: `created_at` tiene duplicados —una saga
// puede escribir dos entradas en la misma transacción— y sin un segundo criterio
// el orden entre ellas lo decide el planificador. Dos páginas consecutivas
// podrían entonces repetir una notificación y saltarse otra.
const listInAppQuery = `
SELECT id, user_id, type, payload, read_state, created_at, read_at
  FROM inapp_notifications
 WHERE user_id = $1
 ORDER BY created_at DESC, id DESC
 LIMIT $2 OFFSET $3`

const countInAppQuery = `SELECT COUNT(*) FROM inapp_notifications WHERE user_id = $1`

// ListInAppNotifications devuelve la página y el total.
//
// Son dos consultas y no una con `COUNT(*) OVER ()`: la función de ventana
// devuelve el total en cada fila, así que una página vacía —la última, o un
// desplazamiento pasado el final— no traería ninguna y el total saldría 0 cuando
// en realidad no lo es. El coste es que el total puede quedar desfasado en una
// fila si alguien escribe entre ambas consultas, que en una bandeja no cambia
// ninguna decisión.
func (s *PostgresStorer) ListInAppNotifications(
	ctx context.Context,
	userID uuid.UUID,
	limit, offset int32,
) ([]InAppNotificationRow, int64, error) {
	rows := []InAppNotificationRow{}
	if err := s.db.SelectContext(ctx, &rows, listInAppQuery, userID, limit, offset); err != nil {
		return nil, 0, classify("listar bandeja in-app", err)
	}

	var total int64
	if err := s.db.GetContext(ctx, &total, countInAppQuery, userID); err != nil {
		return nil, 0, classify("contar bandeja in-app", err)
	}
	return rows, total, nil
}

// markNotificationReadQuery marca la entrada como leída sin mover `read_at` si ya
// lo estaba.
//
// Dos detalles que parecen menores y no lo son:
//
//   - `user_id` va en el WHERE. Es lo único que impide que un usuario marque como
//     leída la notificación de otro conociendo su identificador, y tiene que estar
//     en la consulta y no en una comprobación previa en Go, donde un camino de
//     código futuro podría saltársela.
//   - `COALESCE(read_at, now())` conserva la marca original. Sin el COALESCE, una
//     segunda llamada reescribiría la hora y el usuario vería que «leyó» algo en
//     un momento en que no estaba delante.
const markNotificationReadQuery = `
UPDATE inapp_notifications
   SET read_state = 'read', read_at = COALESCE(read_at, now())
 WHERE id = $2 AND user_id = $1
RETURNING id`

func (s *PostgresStorer) MarkNotificationRead(ctx context.Context, userID, notificationID uuid.UUID) error {
	var id uuid.UUID
	err := s.db.GetContext(ctx, &id, markNotificationReadQuery, userID, notificationID)
	if errors.Is(err, sql.ErrNoRows) {
		// No existe O es de otro usuario, y desde fuera son indistinguibles a
		// propósito: un error distinto para «existe pero no es tuya» confirmaría la
		// existencia de la notificación ajena.
		return wrap("marcar notificación como leída", ErrNotFound)
	}
	if err != nil {
		return classify("marcar notificación como leída", err)
	}
	return nil
}
