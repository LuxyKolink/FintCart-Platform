package storer

import (
	"context"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/shopspring/decimal"
)

// Persistencia del progreso (FR-014) y de los historiales de lectura (FR-015).

// ApplyBestScore es la operación monótona de D-07: guarda el puntaje solo si
// mejora el registrado para ese cuestionario y recalcula los puntos.
//
// Toca `quiz_best_score` y `progress`, así que va en [PostgresStorer.execTx]. La
// transacción no es decorativa: si el mejor puntaje se guardara y el recálculo de
// puntos fallara, la operación dejaría de ser idempotente —un reintento vería el
// puntaje ya almacenado, decidiría que no mejora y no volvería a sumar los
// puntos—, y el usuario perdería progreso de forma permanente e invisible.
func (s *PostgresStorer) ApplyBestScore(
	ctx context.Context,
	userID, quizID uuid.UUID,
	score decimal.Decimal,
) (ProgressRow, error) {
	_, _ = userID, quizID
	_ = score
	var out ProgressRow
	if err := s.execTx(ctx, func(_ *sqlx.Tx) error {
		// T093 implementa:
		//   1. UPSERT en quiz_best_score con `WHERE excluded.best_score > best_score`
		//      (la comparación es NUMERIC, nunca float — Principio VIII).
		//   2. UPDATE progress.points = Σ de los mejores puntajes del usuario,
		//      recalculada y no incrementada, para que el reintento converja al
		//      mismo valor.
		return ErrNotImplemented
	}); err != nil {
		return ProgressRow{}, err
	}
	return out, nil
}

func (s *PostgresStorer) GetProgress(_ context.Context, _ uuid.UUID) (ProgressRow, error) {
	return ProgressRow{}, ErrNotImplemented
}

// RecordArticleView cuenta una lectura. Una sola tabla, así que no necesita
// transacción explícita: el UPSERT ya es atómico.
func (s *PostgresStorer) RecordArticleView(_ context.Context, _, _ uuid.UUID) error {
	return ErrNotImplemented
}

// CountArticleViews cuenta artículos DISTINTOS, no lecturas.
//
// La clave primaria de `article_views` es `(user_id, article_id)`, así que un
// `COUNT(*)` filtrado por usuario ya da artículos distintos; releer el mismo
// artículo incrementa `view_count`, no el número de filas.
func (s *PostgresStorer) CountArticleViews(_ context.Context, _ uuid.UUID) (int64, error) {
	return 0, ErrNotImplemented
}
