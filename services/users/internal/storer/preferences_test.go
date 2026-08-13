package storer

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// Pruebas de persistencia de `preferences` (T153, §Calidad: `go-sqlmock`, sin
// base de datos viva) — ver la cabecera de `storer_postgres_test.go` para qué
// cubren y qué no.

func TestGetPreferencesTranslatesNoRows(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	// Ausencia de fila es una ANOMALÍA y no «preferencias en blanco»:
	// `CreateProfile` la crea siempre junto con el perfil (ver el comentario de
	// `GetPreferences`).
	mock.ExpectQuery("SELECT .* FROM preferences WHERE user_id").WithArgs(id).
		WillReturnRows(sqlmock.NewRows([]string{}))

	_, err := s.GetPreferences(context.Background(), id)
	require.ErrorIs(t, err, ErrNotFound)
}

func TestGetPreferencesReturnsTheStoredRow(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	mock.ExpectQuery("FROM preferences WHERE user_id").WithArgs(id).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "locale", "notif_inapp", "notif_email", "payload", "updated_at"}).
			AddRow(id.String(), "es-CO", true, false, []byte(`{"tema":"oscuro"}`), time.Now()))

	row, err := s.GetPreferences(context.Background(), id)
	require.NoError(t, err)
	require.Equal(t, "es-CO", row.Locale)
	require.True(t, row.NotifInApp)
	require.False(t, row.NotifEmail)
	require.JSONEq(t, `{"tema":"oscuro"}`, string(row.Payload))
}

// TestUpsertPreferencesWritesAllFiveColumns comprueba que el upsert manda las
// CINCO columnas y no solo las que cambiaron: es un `INSERT ... ON CONFLICT DO
// UPDATE` sobre la fila COMPLETA (ver el comentario de `UpsertPreferences`), y
// `server.preferencesToRow` es quien ya fusionó lo nuevo con lo existente antes
// de llegar aquí — esta capa no vuelve a decidir qué cambió.
func TestUpsertPreferencesWritesAllFiveColumns(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	mock.ExpectExec("INSERT INTO preferences").
		WithArgs(id, "en-US", true, true, []byte(`{}`)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := s.UpsertPreferences(context.Background(), PreferencesRow{
		UserID: id, Locale: "en-US", NotifInApp: true, NotifEmail: true,
	})
	require.NoError(t, err)
}

// TestUpsertPreferencesDefaultsANilPayloadToAnEmptyObject: un `Payload` nil no
// debe llegar como `NULL` — la columna es `JSONB NOT NULL DEFAULT '{}'` y un
// nulo violaría esa restricción en lugar de simplemente no llevar preferencias
// adicionales.
func TestUpsertPreferencesDefaultsANilPayloadToAnEmptyObject(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	mock.ExpectExec("INSERT INTO preferences").
		WithArgs(id, "es-CO", true, true, []byte("{}")).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := s.UpsertPreferences(context.Background(), PreferencesRow{
		UserID: id, Locale: "es-CO", NotifInApp: true, NotifEmail: true, Payload: nil,
	})
	require.NoError(t, err)
}

func TestUpsertPreferencesTranslatesAMissingProfile(t *testing.T) {
	t.Parallel()
	s, mock := newMockStorer(t)
	id := mustUUID(t, testUserID)

	// `preferences.user_id` referencia `profiles(id)`: un usuario inexistente
	// viola la clave foránea, y `classify` la traduce a `ErrNotFound` (la misma
	// convención que el resto de este servicio, ver el comentario de `classify`).
	mock.ExpectExec("INSERT INTO preferences").
		WithArgs(id, "es-CO", true, true, []byte("{}")).
		WillReturnError(pgErr(pgForeignKeyViolation))

	err := s.UpsertPreferences(context.Background(), PreferencesRow{
		UserID: id, Locale: "es-CO", NotifInApp: true, NotifEmail: true,
	})
	require.ErrorIs(t, err, ErrNotFound)
}
