// Tipos de FILA del Servicio de Usuarios: la representación de un registro tal
// como vive en `users_db`, y nada más.
//
// Principio IX regla 3 — «DTO ≠ tipo de dominio ≠ tipo de fila». Estos structs
// son el tercero de los tres. No llevan validación de negocio ni etiquetas JSON:
// solo `db:` para `sqlx`. La conversión fila ↔ dominio ocurre exclusivamente en
// `internal/server/mapping.go`, y la de dominio ↔ proto en
// `internal/handler/mapping.go`.
//
// Los nombres y tipos siguen la migración `*_init_users.up.sql` columna por
// columna: si el esquema cambia, este archivo cambia con él y el compilador
// señala los puntos de mapeo afectados.
package storer

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ProfileRow ≡ tabla `profiles`.
type ProfileRow struct {
	ID            uuid.UUID `db:"id"`
	Email         string    `db:"email"`
	DisplayName   string    `db:"display_name"`
	EmailVerified bool      `db:"email_verified"`
	AccountStatus string    `db:"account_status"`
	CreatedAt     time.Time `db:"created_at"`
	UpdatedAt     time.Time `db:"updated_at"`
}

// RoleRow ≡ tabla `roles_assignment`.
type RoleRow struct {
	UserID     uuid.UUID `db:"user_id"`
	Role       string    `db:"role"`
	AssignedAt time.Time `db:"assigned_at"`
}

// PreferencesRow ≡ tabla `preferences`.
//
// `Payload` se transporta como los bytes crudos del `JSONB`: decodificarlo aquí
// obligaría a esta capa a conocer la forma del documento, que es una decisión de
// dominio. Lo decodifica `server`.
type PreferencesRow struct {
	UserID     uuid.UUID `db:"user_id"`
	Locale     string    `db:"locale"`
	NotifInApp bool      `db:"notif_inapp"`
	NotifEmail bool      `db:"notif_email"`
	Payload    []byte    `db:"payload"`
	UpdatedAt  time.Time `db:"updated_at"`
}

// ProgressRow ≡ tabla `progress`.
//
// `Points` es `INTEGER` en el esquema —un contador, no un importe—, así que aquí
// es `int32` y no `decimal.Decimal`. El Principio VIII prohíbe el punto flotante
// para valores monetarios; no obliga a usar decimal para todo lo que sea número.
type ProgressRow struct {
	UserID    uuid.UUID `db:"user_id"`
	Points    int32     `db:"points"`
	UpdatedAt time.Time `db:"updated_at"`
}

// QuizBestScoreRow ≡ tabla `quiz_best_score`.
//
// `BestScore` es `NUMERIC(6,2)` y por tanto `decimal.Decimal` (Principio VIII,
// NON-NEGOTIABLE): una calificación que pase por `float64` puede dejar de ser
// comparable consigo misma, y de esa comparación depende la monotonía de
// `ApplyQuizScore` (D-07).
type QuizBestScoreRow struct {
	UserID    uuid.UUID       `db:"user_id"`
	QuizID    uuid.UUID       `db:"quiz_id"`
	BestScore decimal.Decimal `db:"best_score"`
	UpdatedAt time.Time       `db:"updated_at"`
}

// ArticleViewRow ≡ tabla `article_views`.
type ArticleViewRow struct {
	UserID        uuid.UUID `db:"user_id"`
	ArticleID     uuid.UUID `db:"article_id"`
	FirstViewedAt time.Time `db:"first_viewed_at"`
	LastViewedAt  time.Time `db:"last_viewed_at"`
	ViewCount     int32     `db:"view_count"`
}

// InAppNotificationRow ≡ tabla `inapp_notifications` (la bandeja in-app es
// propiedad de este servicio, no de Notificación — plan.md N-03).
//
// `ReadAt` es nullable y el esquema garantiza por CHECK que existe si y solo si
// `ReadState = 'read'`; el puntero refleja esa nulabilidad en lugar de esconderla
// tras un cero.
type InAppNotificationRow struct {
	ID        uuid.UUID  `db:"id"`
	UserID    uuid.UUID  `db:"user_id"`
	Type      string     `db:"type"`
	Payload   []byte     `db:"payload"`
	ReadState string     `db:"read_state"`
	CreatedAt time.Time  `db:"created_at"`
	ReadAt    *time.Time `db:"read_at"`
}
