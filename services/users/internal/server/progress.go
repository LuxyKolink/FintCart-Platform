package server

import (
	"context"
	"fmt"

	"github.com/fintcart/platform/services/users/internal/decimalstr"
)

// Progress es la vista de dominio del avance de aprendizaje (FR-014).
//
// `Points` es un contador entero: la suma del MEJOR puntaje por cuestionario
// distinto, redondeada por el esquema a `INTEGER`. El puntaje individual sí es
// decimal, y por eso `ApplyQuizScore` recibe una `DecimalString` y no un número.
type Progress struct {
	UserID string
	Points int32
}

// ApplyQuizScore aplica el puntaje de un intento de forma monótona (D-07).
//
// Recibe el puntaje como `string` canónica —el tipo lógico `DecimalString` del
// contrato— y lo convierte AQUÍ, en la frontera, con el helper `decimalstr`. Ese
// helper valida además que el valor quepa en `NUMERIC(6,2)`, así que un puntaje
// imposible se rechaza antes de tocar la base y no en mitad de la transacción de
// la saga.
func (s *Server) ApplyQuizScore(ctx context.Context, userID, quizID, score string) (Progress, error) {
	id, err := parseUserID(userID)
	if err != nil {
		return Progress{}, err
	}
	quiz, err := parseUserID(quizID)
	if err != nil {
		return Progress{}, fmt.Errorf("%w: quiz_id %q no es un UUID", ErrInvalidArgument, quizID)
	}

	value, err := decimalstr.ParseScore(score)
	if err != nil {
		return Progress{}, fmt.Errorf("%w: score: %w", ErrInvalidArgument, err)
	}

	row, err := s.store.ApplyBestScore(ctx, id, quiz, value)
	if err != nil {
		return Progress{}, fmt.Errorf("aplicar mejor puntaje: %w", err)
	}
	return progressFromRow(row), nil
}

// GetProgress devuelve el progreso acumulado.
func (s *Server) GetProgress(ctx context.Context, userID string) (Progress, error) {
	id, err := parseUserID(userID)
	if err != nil {
		return Progress{}, err
	}
	row, err := s.store.GetProgress(ctx, id)
	if err != nil {
		return Progress{}, fmt.Errorf("leer progreso: %w", err)
	}
	return progressFromRow(row), nil
}

// RecordArticleView registra una lectura de artículo (FR-015).
func (s *Server) RecordArticleView(ctx context.Context, userID, articleID string) error {
	id, err := parseUserID(userID)
	if err != nil {
		return err
	}
	article, err := parseUserID(articleID)
	if err != nil {
		return fmt.Errorf("%w: article_id %q no es un UUID", ErrInvalidArgument, articleID)
	}
	if err := s.store.RecordArticleView(ctx, id, article); err != nil {
		return fmt.Errorf("registrar lectura de artículo: %w", err)
	}
	return nil
}
