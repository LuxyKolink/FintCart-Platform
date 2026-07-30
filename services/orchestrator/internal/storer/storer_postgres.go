package storer

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

// PostgresStorer es la implementación de [Storer] sobre `orchestrator_db`.
type PostgresStorer struct {
	db *sqlx.DB
}

// NewPostgresStorer construye el storer sobre un pool ya abierto (Principio X).
func NewPostgresStorer(db *sqlx.DB) *PostgresStorer {
	return &PostgresStorer{db: db}
}

// execTx ejecuta `fn` en una transacción: confirma si devuelve nil, revierte en
// cualquier otro caso (Principio XI regla 4).
//
// En este servicio es la pieza central y no una utilidad: la garantía de D-07
// —avance de saga y evento en la misma transacción— es exactamente lo que este
// helper implementa. El `*sqlx.Tx` no sale hacia `server`: el motor de saga decide
// QUÉ escribir, no cuándo empieza y acaba una transacción.
func (s *PostgresStorer) execTx(ctx context.Context, fn func(tx *sqlx.Tx) error) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return wrap("abrir transacción", err)
	}

	if err := fn(tx); err != nil {
		// `sql.ErrTxDone`: la transacción ya había terminado (contexto cancelado,
		// por ejemplo). No es un fallo del rollback y no debe tapar el error real.
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

// ── saga_state ──────────────────────────────────────────────────────────────

func (s *PostgresStorer) CreateSaga(_ context.Context, _ string, _ []byte) (uuid.UUID, error) {
	return uuid.Nil, ErrNotImplemented
}

func (s *PostgresStorer) GetSaga(_ context.Context, _ uuid.UUID) (SagaRow, error) {
	return SagaRow{}, ErrNotImplemented
}

// AdvanceSaga es la escritura crítica de D-07: `saga_state` + `event_outbox` en una
// sola transacción.
func (s *PostgresStorer) AdvanceSaga(
	ctx context.Context,
	sagaID uuid.UUID,
	step int32,
	compensations []byte,
	events []OutboxRow,
) error {
	_, _ = sagaID, step
	_, _ = compensations, events
	return s.execTx(ctx, func(_ *sqlx.Tx) error {
		// T060/T061 implementan:
		//   1. UPDATE saga_state SET current_step, compensations, updated_at
		//      WHERE id = $1 AND current_step = $2 - 1
		//      La condición sobre `current_step` es un bloqueo optimista: dos
		//      ejecuciones concurrentes de la misma saga (una reanudación que se
		//      solapa con el flujo original) no deben avanzar el paso dos veces.
		//   2. INSERT en event_outbox de cada evento, con `published_at` nulo.
		return ErrNotImplemented
	})
}

func (s *PostgresStorer) MarkStatus(_ context.Context, _ uuid.UUID, _ string, _ error) error {
	return ErrNotImplemented
}

func (s *PostgresStorer) ListResumable(_ context.Context, _ int32) ([]SagaRow, error) {
	return nil, ErrNotImplemented
}

// ── event_outbox ────────────────────────────────────────────────────────────

func (s *PostgresStorer) ListPendingEvents(_ context.Context, _ int32) ([]OutboxRow, error) {
	// T061: `SELECT ... WHERE published_at IS NULL ORDER BY created_at
	// FOR UPDATE SKIP LOCKED`. El `SKIP LOCKED` es lo que permite ejecutar más de
	// una réplica del publicador sin que dos publiquen el mismo evento.
	return nil, ErrNotImplemented
}

func (s *PostgresStorer) MarkEventPublished(_ context.Context, _ uuid.UUID) error {
	return ErrNotImplemented
}

func (s *PostgresStorer) IncrementEventAttempts(_ context.Context, _ uuid.UUID, _ error) error {
	return ErrNotImplemented
}
