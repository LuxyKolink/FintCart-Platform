package storer

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

// PostgresStorer es la implementación de [Storer] sobre `auth_db`.
type PostgresStorer struct {
	db *sqlx.DB
}

// NewPostgresStorer construye el storer sobre un pool ya abierto (Principio X: la
// configuración se lee en `cmd/auth/main.go`, no aquí).
func NewPostgresStorer(db *sqlx.DB) *PostgresStorer {
	return &PostgresStorer{db: db}
}

// execTx ejecuta `fn` en una transacción: confirma si devuelve nil, revierte en
// cualquier otro caso (Principio XI regla 4).
//
// Único lugar del servicio donde se abre, confirma o revierte una transacción. El
// `*sqlx.Tx` no aparece en la interfaz [Storer]: el control transaccional no cruza
// hacia arriba, porque si `server` pudiera decidir el alcance de una transacción
// acabaría decidiendo el alcance de un bloqueo de base de datos.
func (s *PostgresStorer) execTx(ctx context.Context, fn func(tx *sqlx.Tx) error) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return wrap("abrir transacción", err)
	}

	if err := fn(tx); err != nil {
		// `sql.ErrTxDone` significa que la transacción ya había terminado (por
		// ejemplo, contexto cancelado); no es un fallo del rollback y no debe tapar
		// el error original.
		if rbErr := tx.Rollback(); rbErr != nil && !errors.Is(rbErr, sql.ErrTxDone) {
			return wrap("revertir transacción", errors.Join(err, rbErr))
		}
		return wrap("transacción abortada", err)
	}

	if err := tx.Commit(); err != nil {
		return wrap("confirmar transacción", err)
	}
	return nil
}

// ── credentials ─────────────────────────────────────────────────────────────

func (s *PostgresStorer) CreateCredential(_ context.Context, _ CredentialRow) error {
	return ErrNotImplemented
}

func (s *PostgresStorer) ActivateCredential(_ context.Context, _ uuid.UUID) error {
	return ErrNotImplemented
}

func (s *PostgresStorer) GetCredentialByEmail(_ context.Context, _ string) (CredentialRow, error) {
	return CredentialRow{}, ErrNotImplemented
}

func (s *PostgresStorer) GetCredential(_ context.Context, _ uuid.UUID) (CredentialRow, error) {
	return CredentialRow{}, ErrNotImplemented
}

func (s *PostgresStorer) UpdatePasswordHash(_ context.Context, _ uuid.UUID, _ string) error {
	return ErrNotImplemented
}

// AnonymizeCredential reescribe la credencial y descarta los códigos de
// autorización pendientes del usuario, en una sola transacción.
//
// Las dos escrituras van juntas porque un código sin consumir sobreviviente
// permitiría emitir tokens para una cuenta ya anonimizada — exactamente lo que
// FR-030 prohíbe.
func (s *PostgresStorer) AnonymizeCredential(ctx context.Context, userID uuid.UUID, opaqueEmail string) error {
	_, _ = userID, opaqueEmail
	return s.execTx(ctx, func(_ *sqlx.Tx) error {
		// T162: UPDATE credentials (email opaco, hash inutilizable, `anonymized`)
		// + DELETE de authorization_codes no consumidos del usuario.
		return ErrNotImplemented
	})
}

// ── oauth_clients ───────────────────────────────────────────────────────────

func (s *PostgresStorer) GetOAuthClient(_ context.Context, _ string) (OAuthClientRow, error) {
	return OAuthClientRow{}, ErrNotImplemented
}

// ── authorization_codes ─────────────────────────────────────────────────────

func (s *PostgresStorer) InsertAuthCode(_ context.Context, _ AuthCodeRow) error {
	return ErrNotImplemented
}

// ConsumeAuthCode marca y devuelve el código en una sola sentencia.
//
// T050 lo implementa con `UPDATE ... SET consumed = TRUE WHERE code = $1 AND NOT
// consumed AND expires_at > now() RETURNING *`. La forma importa: un `SELECT`
// seguido de un `UPDATE` deja una ventana en la que dos peticiones concurrentes
// con el mismo código obtienen tokens las dos, que es el ataque de reutilización
// de código que PKCE pretende cerrar.
func (s *PostgresStorer) ConsumeAuthCode(_ context.Context, _ string) (AuthCodeRow, error) {
	return AuthCodeRow{}, ErrNotImplemented
}

func (s *PostgresStorer) DeleteExpiredAuthCodes(_ context.Context, _ time.Time) (int64, error) {
	return 0, ErrNotImplemented
}
