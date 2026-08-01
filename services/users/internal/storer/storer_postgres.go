package storer

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
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

// ── traducción de errores del driver ────────────────────────────────────────

// SQLSTATE de PostgreSQL que esta capa sabe interpretar.
//
// Se interroga el CÓDIGO y no el texto del mensaje: el texto depende de
// `lc_messages` y del nombre de la constraint, así que una comparación por
// substring dejaría de funcionar el día que alguien renombre un índice o cambie
// el idioma del servidor.
const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
	pgCheckViolation      = "23514"
)

// classify traduce un error del driver al centinela que le corresponde,
// conservando la causa.
//
// La violación de clave ajena se traduce a [ErrNotFound] y no a [ErrConflict]
// porque en este esquema TODA clave ajena apunta a `profiles`: el único modo de
// violarla es escribir progreso, lecturas o notificaciones de un usuario que no
// existe, y «no existe» es lo que el llamador necesita saber para distinguir un
// identificador equivocado de una carrera de escritura.
func classify(op string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case pgUniqueViolation, pgCheckViolation:
			return wrap(op, errors.Join(ErrConflict, err))
		case pgForeignKeyViolation:
			return wrap(op, errors.Join(ErrNotFound, err))
		}
	}
	return wrap(op, err)
}

// ── Perfil ──────────────────────────────────────────────────────────────────

// Las cuatro escrituras de `CreateProfile`. Van como constantes con nombre y no
// en línea para que la prueba de persistencia pueda referirse a la misma cadena
// que ejecuta el servicio.
const (
	insertProfileQuery = `
INSERT INTO profiles (id, email, display_name)
VALUES ($1, $2, $3)
ON CONFLICT (id) DO NOTHING`

	insertPreferencesQuery = `
INSERT INTO preferences (user_id) VALUES ($1)
ON CONFLICT (user_id) DO NOTHING`

	insertProgressQuery = `
INSERT INTO progress (user_id) VALUES ($1)
ON CONFLICT (user_id) DO NOTHING`

	insertRoleQuery = `
INSERT INTO roles_assignment (user_id, role) VALUES ($1, $2)
ON CONFLICT (user_id, role) DO NOTHING`
)

// CreateProfile escribe `profiles`, `preferences`, `progress` y
// `roles_assignment`.
//
// Son cuatro tablas, así que va dentro de [PostgresStorer.execTx] por definición:
// un perfil sin preferencias ni rol es un estado que la capa `server` no sabe
// interpretar, y la saga de registro no tiene un paso de compensación para
// «perfil a medio crear».
//
// `progress` se crea aquí aunque el usuario todavía no tenga puntos. La
// alternativa —crearla al aplicar el primer puntaje— haría que la barra de
// progreso de una cuenta recién registrada respondiera «no encontrado» en lugar
// de cero, y FR-014 pide un indicador desde el principio.
//
// Los cuatro `ON CONFLICT ... DO NOTHING` son lo que hace el paso IDEMPOTENTE
// (D-04): la saga de registro reintenta tras un reinicio y el reintento no debe
// fallar ni compensar una cuenta que en realidad se creó bien. Nótese que el
// arbitraje es sobre `id`: un correo que ya pertenece a OTRA cuenta activa sí
// levanta violación de unicidad, y sale como [ErrConflict], que es exactamente el
// caso de correo duplicado de FR-001.
func (s *PostgresStorer) CreateProfile(ctx context.Context, p ProfileRow, initialRole string) error {
	return s.execTx(ctx, func(tx *sqlx.Tx) error {
		if _, err := tx.ExecContext(ctx, insertProfileQuery, p.ID, p.Email, p.DisplayName); err != nil {
			return classify("insertar perfil", err)
		}
		if _, err := tx.ExecContext(ctx, insertPreferencesQuery, p.ID); err != nil {
			return classify("insertar preferencias", err)
		}
		if _, err := tx.ExecContext(ctx, insertProgressQuery, p.ID); err != nil {
			return classify("insertar progreso inicial", err)
		}
		if _, err := tx.ExecContext(ctx, insertRoleQuery, p.ID, initialRole); err != nil {
			return classify("asignar rol inicial", err)
		}
		return nil
	})
}

// markEmailVerifiedQuery exige `account_status = 'active'`.
//
// El estado va en el WHERE y no en una comprobación previa: sin él, un evento de
// verificación que llegue tarde reactivaría el correo de una cuenta ya anonimizada
// (FR-030 la deja inutilizable de forma permanente).
//
// Es idempotente porque la condición no mira `email_verified`: marcar dos veces
// vuelve a afectar la misma fila y devuelve éxito, que es lo que necesita una
// entrega at-least-once.
const markEmailVerifiedQuery = `
UPDATE profiles
   SET email_verified = TRUE, updated_at = now()
 WHERE id = $1 AND account_status = 'active'
RETURNING id`

func (s *PostgresStorer) MarkEmailVerified(ctx context.Context, userID uuid.UUID) error {
	var id uuid.UUID
	err := s.db.GetContext(ctx, &id, markEmailVerifiedQuery, userID)
	if errors.Is(err, sql.ErrNoRows) {
		// La segunda consulta solo corre en el camino de fallo, y sirve para separar
		// dos causas que el cliente trata distinto: un perfil ausente (el registro se
		// compensó) de un perfil anonimizado (la verificación llegó tarde). Sin ella
		// las dos saldrían con el mismo error y el operador tendría que ir a la base
		// a averiguar cuál era.
		return wrap("marcar correo verificado", s.existenceError(ctx, userID))
	}
	if err != nil {
		return classify("marcar correo verificado", err)
	}
	return nil
}

// existenceError decide entre [ErrNotFound] y [ErrConflict] cuando una escritura
// condicionada por `account_status` no afectó ninguna fila.
func (s *PostgresStorer) existenceError(ctx context.Context, userID uuid.UUID) error {
	var exists bool
	if err := s.db.GetContext(ctx, &exists,
		`SELECT EXISTS (SELECT 1 FROM profiles WHERE id = $1)`, userID); err != nil {
		// La causa se conserva: si la comprobación falla, el llamador recibe el error
		// del driver y no un «no encontrado» inventado que le haría creer que el
		// perfil no existe cuando lo que pasó fue que la base no respondió.
		return fmt.Errorf("comprobar existencia del perfil: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	return ErrConflict
}

const selectProfileColumns = `id, email, display_name, email_verified, account_status, created_at, updated_at`

func (s *PostgresStorer) GetProfile(ctx context.Context, userID uuid.UUID) (ProfileRow, error) {
	var row ProfileRow
	err := s.db.GetContext(ctx, &row,
		`SELECT `+selectProfileColumns+` FROM profiles WHERE id = $1`, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return ProfileRow{}, wrap("leer perfil", ErrNotFound)
	}
	if err != nil {
		return ProfileRow{}, classify("leer perfil", err)
	}
	return row, nil
}

const updateDisplayNameQuery = `
UPDATE profiles
   SET display_name = $2, updated_at = now()
 WHERE id = $1 AND account_status = 'active'
RETURNING id`

// UpdateDisplayName aplica una rectificación de datos personales (FR-029).
//
// Excluye las cuentas anonimizadas por la misma razón que
// [PostgresStorer.MarkEmailVerified]: escribir un nombre legible sobre el valor
// opaco que puso FR-030 revertiría la anonimización.
func (s *PostgresStorer) UpdateDisplayName(ctx context.Context, userID uuid.UUID, displayName string) error {
	var id uuid.UUID
	err := s.db.GetContext(ctx, &id, updateDisplayNameQuery, userID, displayName)
	if errors.Is(err, sql.ErrNoRows) {
		return wrap("actualizar nombre visible", s.existenceError(ctx, userID))
	}
	if err != nil {
		return classify("actualizar nombre visible", err)
	}
	return nil
}

// GetRoles devuelve los roles del usuario ordenados alfabéticamente.
//
// El orden es explícito y no el que devuelva el planificador: los roles acaban en
// un claim del JWT, y dos tokens emitidos para el mismo usuario con los roles en
// distinto orden serían bytes distintos sin ser semánticamente distintos, lo que
// rompe cualquier comparación o caché aguas abajo.
//
// Un usuario sin roles NO es un error: `GetAuthContext` ya falla antes si el
// perfil no existe, así que una lista vacía aquí significa exactamente eso —sin
// roles— y no «no encontrado».
func (s *PostgresStorer) GetRoles(ctx context.Context, userID uuid.UUID) ([]RoleRow, error) {
	rows := []RoleRow{}
	err := s.db.SelectContext(ctx, &rows,
		`SELECT user_id, role, assigned_at FROM roles_assignment WHERE user_id = $1 ORDER BY role`, userID)
	if err != nil {
		return nil, classify("leer roles", err)
	}
	return rows, nil
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
