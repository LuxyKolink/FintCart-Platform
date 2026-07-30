// Capa de persistencia del Servicio de Usuarios (Principio IX: la tercera capa,
// por debajo de `server`, que a su vez está por debajo de `handler`).
//
// `Storer` es una interfaz EXPLÍCITA y no un struct concreto, y eso es la mitad
// del punto del Principio IX: la capa `server` depende de este contrato, no de
// PostgreSQL. Consecuencias prácticas:
//
//   - Las pruebas de la capa de aplicación no necesitan una base de datos viva
//     (§Calidad: doble en memoria o `go-sqlmock`).
//   - La dirección de la dependencia queda comprobada por el compilador: `storer`
//     no importa `server` ni `handler`, así que no existe forma de introducir una
//     dependencia ascendente sin que el ciclo de importación lo delate.
//
// Todos los métodos reciben `context.Context` como primer parámetro (Principio XI
// regla 5) y devuelven los centinelas de `errors.go`, nunca errores del driver.
package storer

import (
	"context"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Storer es el contrato completo de persistencia que consume la capa `server`.
//
// Se declara como una interfaz única y no dividida por dominio a propósito: hay
// un solo implementador real (`PostgresStorer`) y una sola base de datos
// (Principio III), así que fragmentarla solo añadiría nombres sin reducir
// acoplamiento. Los métodos SÍ se agrupan por dominio en archivos distintos.
type Storer interface {
	// ── Perfil (storer_postgres.go) ──────────────────────────────────────────

	// CreateProfile inserta el perfil junto con sus preferencias y su rol
	// inicial. Es idempotente: repetir la llamada con el mismo `id` no falla,
	// porque la saga de registro puede reintentar el paso (D-04).
	CreateProfile(ctx context.Context, p ProfileRow, initialRole string) error
	// MarkEmailVerified es idempotente por naturaleza (marcar dos veces es
	// marcar una).
	MarkEmailVerified(ctx context.Context, userID uuid.UUID) error
	GetProfile(ctx context.Context, userID uuid.UUID) (ProfileRow, error)
	UpdateDisplayName(ctx context.Context, userID uuid.UUID, displayName string) error
	GetRoles(ctx context.Context, userID uuid.UUID) ([]RoleRow, error)
	// AnonymizeProfile sustituye los datos personales por valores opacos y pone
	// `account_status = 'anonymized'` (FR-030). No borra la fila: el progreso y
	// los agregados deben sobrevivir, y las claves foráneas internas apuntan a
	// ella.
	AnonymizeProfile(ctx context.Context, userID uuid.UUID, opaqueEmail, opaqueName string) error

	// ── Preferencias (preferences.go) ────────────────────────────────────────

	GetPreferences(ctx context.Context, userID uuid.UUID) (PreferencesRow, error)
	UpsertPreferences(ctx context.Context, p PreferencesRow) error

	// ── Progreso e historiales (progress.go) ─────────────────────────────────

	// ApplyBestScore aplica el puntaje solo si SUPERA el mejor almacenado y
	// recalcula los puntos en la misma transacción. Devuelve el progreso
	// resultante. La monotonía es lo que hace la operación idempotente y evita
	// una compensación destructiva en la saga de calificación (D-07, FR-027).
	ApplyBestScore(ctx context.Context, userID, quizID uuid.UUID, score decimal.Decimal) (ProgressRow, error)
	GetProgress(ctx context.Context, userID uuid.UUID) (ProgressRow, error)
	// RecordArticleView cuenta una lectura: inserta la fila o incrementa
	// `view_count` y refresca `last_viewed_at` (FR-015).
	RecordArticleView(ctx context.Context, userID, articleID uuid.UUID) error
	// CountArticleViews cuenta artículos DISTINTOS vistos, no lecturas totales:
	// es el `articles_viewed` del reporte de actividad (FR-018).
	CountArticleViews(ctx context.Context, userID uuid.UUID) (int64, error)

	// ── Bandeja in-app (storer_postgres.go) ──────────────────────────────────

	AppendInAppNotification(ctx context.Context, n InAppNotificationRow) error
	// ListInAppNotifications devuelve la página y el total de filas del usuario,
	// para que `server` pueda construir el `PageResponse` del contrato.
	ListInAppNotifications(ctx context.Context, userID uuid.UUID, limit, offset int32) ([]InAppNotificationRow, int64, error)
	MarkNotificationRead(ctx context.Context, userID, notificationID uuid.UUID) error
}

// Comprobación en tiempo de compilación de que el implementador de PostgreSQL
// satisface el contrato. Sin esta línea, un método que se olvide de actualizar
// tras cambiar la interfaz solo fallaría al ensamblar en `main.go`, mucho más
// lejos del cambio.
var _ Storer = (*PostgresStorer)(nil)
