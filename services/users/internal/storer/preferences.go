package storer

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
)

// Persistencia de `preferences` (FR-017, FR-029: consulta y rectificación).

const selectPreferencesColumns = `user_id, locale, notif_inapp, notif_email, payload, updated_at`

// GetPreferences lee la fila de preferencias del usuario.
//
// Devuelve [ErrNotFound] y no una fila vacía si no existe: `CreateProfile` la crea
// siempre junto con el perfil, así que su ausencia es una anomalía que quien llama
// necesita distinguir de «preferencias en blanco».
func (s *PostgresStorer) GetPreferences(ctx context.Context, userID uuid.UUID) (PreferencesRow, error) {
	var row PreferencesRow
	err := s.db.GetContext(ctx, &row,
		`SELECT `+selectPreferencesColumns+` FROM preferences WHERE user_id = $1`, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return PreferencesRow{}, wrap("leer preferencias", ErrNotFound)
	}
	if err != nil {
		return PreferencesRow{}, classify("leer preferencias", err)
	}
	return row, nil
}

const upsertPreferencesQuery = `
INSERT INTO preferences (user_id, locale, notif_inapp, notif_email, payload, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (user_id) DO UPDATE
   SET locale = EXCLUDED.locale,
       notif_inapp = EXCLUDED.notif_inapp,
       notif_email = EXCLUDED.notif_email,
       payload = EXCLUDED.payload,
       updated_at = now()`

// UpsertPreferences es un upsert y no un update por una razón concreta: la fila
// de preferencias se crea junto con el perfil, pero un perfil migrado o creado
// antes de que existiera la tabla podría no tenerla, y en ese caso «rectificar
// mis preferencias» debe funcionar igual en lugar de devolver «no encontrado».
func (s *PostgresStorer) UpsertPreferences(ctx context.Context, p PreferencesRow) error {
	payload := p.Payload
	if payload == nil {
		payload = []byte("{}")
	}
	if _, err := s.db.ExecContext(ctx, upsertPreferencesQuery,
		p.UserID, p.Locale, p.NotifInApp, p.NotifEmail, payload); err != nil {
		return classify("guardar preferencias", err)
	}
	return nil
}
