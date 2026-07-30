package storer

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

// PostgresStorer es la única implementación real de [Storer].
//
// Guarda un `*sqlx.DB` —un pool, no una conexión— y ningún otro estado: no hay
// caché, ni configuración de negocio, ni conexión a otro servicio. Cualquier cosa
// que no sea «traducir una llamada de método en SQL contra users_db» pertenece a
// la capa `server`.
type PostgresStorer struct {
	db *sqlx.DB
}

// NewPostgresStorer construye el storer sobre un pool ya abierto.
//
// Recibe el `*sqlx.DB` en lugar de una cadena de conexión (Principio X: la
// configuración se lee en el entrypoint, no en las capas internas). Así esta capa
// no conoce variables de entorno y `cmd/users/main.go` sigue siendo el único
// lugar donde se decide a qué base se habla.
func NewPostgresStorer(db *sqlx.DB) *PostgresStorer {
	return &PostgresStorer{db: db}
}

// execTx ejecuta `fn` dentro de una transacción: confirma si devuelve nil y
// revierte en cualquier otro caso (Principio XI regla 4, «escrituras multi-tabla
// vía helper `execTx`»).
//
// Es el ÚNICO lugar del servicio donde se abre, confirma o revierte una
// transacción. Centralizarlo no es una preferencia de estilo: una escritura
// multi-tabla que empieza una transacción a mano y olvida un `Rollback` en un
// camino de error deja una conexión del pool retenida hasta el timeout, y el
// síntoma —agotamiento del pool bajo carga— aparece lejísimos de la causa. Con un
// solo helper hay un solo lugar donde eso puede estar mal, y está probado.
//
// La firma pasa el `*sqlx.Tx` a la clausura en vez de exponerlo en la interfaz
// `Storer`: el control transaccional NO cruza hacia arriba. Si `server` pudiera
// abrir transacciones, la capa de aplicación acabaría decidiendo el alcance de un
// bloqueo de base de datos, que es exactamente la responsabilidad que el
// Principio IX le quita.
func (s *PostgresStorer) execTx(ctx context.Context, fn func(tx *sqlx.Tx) error) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return wrap("abrir transacción", err)
	}

	if err := fn(tx); err != nil {
		// `sql.ErrTxDone` significa que la transacción ya terminó (por ejemplo,
		// porque el contexto se canceló y el driver la abortó). No es un fallo
		// del rollback y no debe tapar el error original.
		if rbErr := tx.Rollback(); rbErr != nil && !errors.Is(rbErr, sql.ErrTxDone) {
			// Se unen los dos: el motivo del fallo Y el hecho de que la reversión
			// tampoco pudo completarse, que es un dato operativo distinto.
			return wrap("revertir transacción", errors.Join(err, rbErr))
		}
		return wrap("transacción abortada", err)
	}

	if err := tx.Commit(); err != nil {
		return wrap("confirmar transacción", err)
	}
	return nil
}

// ── Perfil ──────────────────────────────────────────────────────────────────

// CreateProfile escribe `profiles`, `preferences` y `roles_assignment`.
//
// Son tres tablas, así que va dentro de [PostgresStorer.execTx] por definición:
// un perfil sin preferencias ni rol es un estado que la capa `server` no sabe
// interpretar, y la saga de registro no tiene un paso de compensación para
// «perfil a medio crear».
func (s *PostgresStorer) CreateProfile(ctx context.Context, p ProfileRow, initialRole string) error {
	_ = p
	_ = initialRole
	return s.execTx(ctx, func(_ *sqlx.Tx) error {
		// T092 implementa los tres INSERT con ON CONFLICT DO NOTHING sobre `id`
		// (la saga de registro reintenta el paso, así que debe ser idempotente).
		return ErrNotImplemented
	})
}

func (s *PostgresStorer) MarkEmailVerified(_ context.Context, _ uuid.UUID) error {
	return ErrNotImplemented
}

func (s *PostgresStorer) GetProfile(_ context.Context, _ uuid.UUID) (ProfileRow, error) {
	return ProfileRow{}, ErrNotImplemented
}

func (s *PostgresStorer) UpdateDisplayName(_ context.Context, _ uuid.UUID, _ string) error {
	return ErrNotImplemented
}

func (s *PostgresStorer) GetRoles(_ context.Context, _ uuid.UUID) ([]RoleRow, error) {
	return nil, ErrNotImplemented
}

// AnonymizeProfile reescribe el perfil y purga los datos personales de la
// bandeja in-app en una sola transacción (FR-030).
func (s *PostgresStorer) AnonymizeProfile(ctx context.Context, userID uuid.UUID, opaqueEmail, opaqueName string) error {
	_, _, _ = userID, opaqueEmail, opaqueName
	return s.execTx(ctx, func(_ *sqlx.Tx) error {
		// T161 implementa el UPDATE de `profiles` + el borrado de payloads de
		// `inapp_notifications`, que pueden contener el nombre o el correo.
		return ErrNotImplemented
	})
}

// ── Bandeja in-app (plan.md N-03: la posee este servicio) ───────────────────

func (s *PostgresStorer) AppendInAppNotification(_ context.Context, _ InAppNotificationRow) error {
	return ErrNotImplemented
}

func (s *PostgresStorer) ListInAppNotifications(_ context.Context, _ uuid.UUID, _, _ int32) ([]InAppNotificationRow, int64, error) {
	return nil, 0, ErrNotImplemented
}

func (s *PostgresStorer) MarkNotificationRead(_ context.Context, _, _ uuid.UUID) error {
	return ErrNotImplemented
}
