package storer

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/shopspring/decimal"
)

// Persistencia del progreso (FR-014) y de los historiales de lectura (FR-015).

// lockProgressQuery crea la fila de progreso si falta y, si ya está, la BLOQUEA.
//
// El `DO UPDATE SET user_id = progress.user_id` no cambia nada: existe únicamente
// para tomar el bloqueo de fila, cosa que `DO NOTHING` no hace. Sin él,
// [PostgresStorer.ApplyBestScore] pierde actualizaciones: dos intentos
// concurrentes del mismo usuario en cuestionarios DISTINTOS leen cada uno una
// suma que no incluye al otro —bajo READ COMMITTED ninguno ve la escritura no
// confirmada del vecino— y el último en confirmar deja unos puntos a los que le
// falta un cuestionario entero. El síntoma sería «a veces se pierden puntos», que
// no se reproduce a voluntad y no deja rastro en ningún log.
const lockProgressQuery = `
INSERT INTO progress (user_id) VALUES ($1)
ON CONFLICT (user_id) DO UPDATE SET user_id = progress.user_id`

// applyBestScoreQuery guarda el puntaje solo si SUPERA al almacenado.
//
// La condición vive en el `WHERE` del `DO UPDATE` y no en un `SELECT` previo
// seguido de un `if`: entre la lectura y la escritura cabe otro intento, y la
// comparación hecha fuera de la base decidiría sobre un valor ya obsoleto.
//
// La comparación es entre `NUMERIC`, nunca entre `float` (Principio VIII): de
// esta desigualdad depende la monotonía, y dos calificaciones que en decimal son
// distintas pueden ser el mismo `float64`.
//
// Cuando la condición no se cumple, el `DO UPDATE` no afecta filas y tampoco
// falla — que es justo lo que hace idempotente el reintento de la saga (D-07).
const applyBestScoreQuery = `
INSERT INTO quiz_best_score (user_id, quiz_id, best_score)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, quiz_id) DO UPDATE
   SET best_score = EXCLUDED.best_score, updated_at = now()
 WHERE EXCLUDED.best_score > quiz_best_score.best_score`

// recomputeProgressQuery RECALCULA los puntos desde cero.
//
// Recalcular y no incrementar es lo que hace converger al reintento: un
// `points = points + delta` aplicado dos veces por una entrega duplicada dejaría
// un progreso inflado y permanente, mientras que esta suma da el mismo resultado
// se ejecute una vez o cinco.
//
// `FLOOR` y no `ROUND`: los puntos son un contador entero derivado de una suma
// con dos decimales, y redondear hacia arriba regalaría un punto que el usuario
// no obtuvo. `FLOOR` además conserva la monotonía —si la suma no baja, su piso
// tampoco—, que es la propiedad de la que depende toda la idempotencia de D-07.
// El redondeo half-even de D-14 rige para importes monetarios; esto no lo es.
const recomputeProgressQuery = `
UPDATE progress
   SET points = (SELECT COALESCE(FLOOR(SUM(best_score)), 0)::INTEGER
                   FROM quiz_best_score WHERE user_id = $1),
       updated_at = now()
 WHERE user_id = $1
RETURNING user_id, points, updated_at`

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
	var out ProgressRow
	if err := s.execTx(ctx, func(tx *sqlx.Tx) error {
		if _, err := tx.ExecContext(ctx, lockProgressQuery, userID); err != nil {
			return classify("bloquear progreso", err)
		}
		if _, err := tx.ExecContext(ctx, applyBestScoreQuery, userID, quizID, score); err != nil {
			return classify("aplicar mejor puntaje", err)
		}
		if err := tx.GetContext(ctx, &out, recomputeProgressQuery, userID); err != nil {
			return classify("recalcular puntos", err)
		}
		return nil
	}); err != nil {
		return ProgressRow{}, err
	}
	return out, nil
}

func (s *PostgresStorer) GetProgress(ctx context.Context, userID uuid.UUID) (ProgressRow, error) {
	var row ProgressRow
	err := s.db.GetContext(ctx, &row,
		`SELECT user_id, points, updated_at FROM progress WHERE user_id = $1`, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return ProgressRow{}, wrap("leer progreso", ErrNotFound)
	}
	if err != nil {
		return ProgressRow{}, classify("leer progreso", err)
	}
	return row, nil
}

// recordArticleViewQuery inserta la primera lectura o incrementa las siguientes.
//
// `first_viewed_at` NO se toca en el `DO UPDATE`: es el dato que distingue
// «cuándo descubrió este artículo» de «cuándo lo leyó por última vez», y
// refrescarlo dejaría las dos columnas diciendo lo mismo.
const recordArticleViewQuery = `
INSERT INTO article_views (user_id, article_id) VALUES ($1, $2)
ON CONFLICT (user_id, article_id) DO UPDATE
   SET view_count = article_views.view_count + 1, last_viewed_at = now()`

// RecordArticleView cuenta una lectura. Una sola tabla, así que no necesita
// transacción explícita: el UPSERT ya es atómico.
func (s *PostgresStorer) RecordArticleView(ctx context.Context, userID, articleID uuid.UUID) error {
	if _, err := s.db.ExecContext(ctx, recordArticleViewQuery, userID, articleID); err != nil {
		return classify("registrar lectura de artículo", err)
	}
	return nil
}

// CountArticleViews cuenta artículos DISTINTOS, no lecturas.
//
// La clave primaria de `article_views` es `(user_id, article_id)`, así que un
// `COUNT(*)` filtrado por usuario ya da artículos distintos; releer el mismo
// artículo incrementa `view_count`, no el número de filas.
func (s *PostgresStorer) CountArticleViews(ctx context.Context, userID uuid.UUID) (int64, error) {
	var n int64
	if err := s.db.GetContext(ctx, &n,
		`SELECT COUNT(*) FROM article_views WHERE user_id = $1`, userID); err != nil {
		return 0, classify("contar artículos vistos", err)
	}
	return n, nil
}
