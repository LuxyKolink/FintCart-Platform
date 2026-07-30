package storer

import (
	"context"

	"github.com/google/uuid"
)

// Persistencia de `preferences` (FR-017, FR-029: consulta y rectificación).

func (s *PostgresStorer) GetPreferences(_ context.Context, _ uuid.UUID) (PreferencesRow, error) {
	return PreferencesRow{}, ErrNotImplemented
}

// UpsertPreferences es un upsert y no un update por una razón concreta: la fila
// de preferencias se crea junto con el perfil, pero un perfil migrado o creado
// antes de que existiera la tabla podría no tenerla, y en ese caso «rectificar
// mis preferencias» debe funcionar igual en lugar de devolver «no encontrado».
func (s *PostgresStorer) UpsertPreferences(_ context.Context, _ PreferencesRow) error {
	return ErrNotImplemented
}
