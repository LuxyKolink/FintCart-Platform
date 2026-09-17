package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	simulatorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/simulator/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Pruebas del barrido del calendario de indicadores (T105, FR-061).
//
// Lo que se comprueba aquí es la DECISIÓN del barrido, que es lo único que no se puede
// verificar contra la base: qué se publica, con qué identificador y cuándo NO se publica
// nada. La idempotencia real la impone el `ON CONFLICT (id) DO NOTHING` de
// `InsertStandaloneEvent`, y el doble de abajo imita esa clave primaria —si no lo hiciera,
// una prueba sobre la idempotencia sería verde sin comprobar nada—.

const testAlertEmail = "administracion@fintcart.test"

// El doble del Simulador vive en `saga_simulation_test.go`, que ya lo declara para el
// camino de la simulación. Aquí se le añade el RPC del calendario: declarar un segundo
// `fakeSimulator` obligaría a las pruebas de la saga a elegir cuál usar, y dos dobles del
// mismo servicio acaban divergiendo.

// fakeStore imita `event_outbox` en lo que importa: la clave primaria y su
// `ON CONFLICT DO NOTHING`.
type fakeStore struct {
	storer.Storer

	rows    []storer.OutboxRow
	inserts int
	err     error
}

func (f *fakeStore) InsertStandaloneEvent(_ context.Context, row storer.OutboxRow) (bool, error) {
	f.inserts++
	if f.err != nil {
		return false, f.err
	}
	for _, existing := range f.rows {
		if existing.ID == row.ID {
			return false, nil
		}
	}
	f.rows = append(f.rows, row)
	return true, nil
}

// captureLogger devuelve un logger que no escribe y una función para leer lo registrado.
func captureLogger(buffer *[]string) *slog.Logger {
	return slog.New(slog.NewTextHandler(&writerTo{buffer: buffer}, &slog.HandlerOptions{}))
}

type writerTo struct{ buffer *[]string }

// io.Writer mínimo: el barrido solo necesita poder escribir.
func (w *writerTo) Write(p []byte) (int, error) {
	*w.buffer = append(*w.buffer, string(p))
	return len(p), nil
}

var _ io.Writer = (*writerTo)(nil)

// sweeperDePrueba construye el barrido con la fecha fija y el estado indicado.
func sweeperDePrueba(
	status *simulatorv1.IndicatorCalendarStatus,
	store storer.Storer,
	alertEmail string,
) (*Sweeper, *fakeSimulator) {
	sim := &fakeSimulator{calendarStatus: status}
	var logs []string
	sweeper := NewSweeper(sim, store, alertEmail, captureLogger(&logs))
	// Fecha fija: el identificador del aviso depende del día, y con el reloj real una
	// prueba cambiaría de identificador a medianoche.
	sweeper.now = func() time.Time {
		return time.Date(2026, 6, 15, 3, 0, 0, 0, time.UTC)
	}
	return sweeper, sim
}

func calendarioConHuecos() *simulatorv1.IndicatorCalendarStatus {
	return &simulatorv1.IndicatorCalendarStatus{
		MissingNames: []string{"SMMLV", "UVT"},
		Expiring: []*simulatorv1.ExpiringIndicator{
			{Name: "IPC", ValidTo: "2027-01-01", DaysRemaining: 12},
		},
	}
}

func TestSweepPublishesOneAlertPerIndicator(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	sweeper, _ := sweeperDePrueba(calendarioConHuecos(), store, testAlertEmail)

	resumen, err := sweeper.SweepIndicators(context.Background())
	require.NoError(t, err)

	// Dos sin vigencia + uno por vencer: tres avisos, y cada uno es un correo distinto
	// porque cada uno pide actuar sobre un indicador concreto.
	require.Equal(t, 3, resumen.Publicados)
	require.Equal(t, 3, len(store.rows))

	// El orden es el de la respuesta del Simulador, no el de un mapa: el correo tiene que
	// salir igual en cada barrido.
	require.Equal(t, "SMMLV", nameOf(t, store.rows[0]))
	require.Equal(t, "UVT", nameOf(t, store.rows[1]))
	require.Equal(t, "IPC", nameOf(t, store.rows[2]))
}

func TestSweepPublishesOnlyIndicatorsWithoutValidityAsMissing(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	sweeper, _ := sweeperDePrueba(calendarioConHuecos(), store, testAlertEmail)
	_, err := sweeper.SweepIndicators(context.Background())
	require.NoError(t, err)

	require.Equal(t, "sin_vigencia", kindOf(t, store.rows[0]))
	require.Equal(t, "sin_vigencia", kindOf(t, store.rows[1]))
	require.Equal(t, "por_vencer", kindOf(t, store.rows[2]))

	// La clase viaja en el payload porque es lo que distingue dos avisos del MISMO
	// indicador: uno puede quedarse sin vigencia y otro estar por vencer, y el correo no
	// puede decir lo mismo en los dos casos.
	require.Equal(t, "2027-01-01", payloadOf(t, store.rows[2])["valid_to"])
	require.Equal(t, float64(12), payloadOf(t, store.rows[2])["days_remaining"])
	require.Equal(t, "", payloadOf(t, store.rows[0])["valid_to"])
}

func TestSweepCarriesTheMailboxForTheNotificationService(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	sweeper, _ := sweeperDePrueba(calendarioConHuecos(), store, testAlertEmail)
	_, err := sweeper.SweepIndicators(context.Background())
	require.NoError(t, err)

	// El correo del destinatario va en el payload porque es el ÚNICO canal que tiene el
	// servicio de Notificación para saber a quién escribe: no conoce a los administradores
	// ni tiene por qué.
	require.Equal(t, testAlertEmail, payloadOf(t, store.rows[0])["email"])
}

func TestSweepIsIdempotentWithinTheSameDay(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	sweeper, sim := sweeperDePrueba(calendarioConHuecos(), store, testAlertEmail)

	primero, err := sweeper.SweepIndicators(context.Background())
	require.NoError(t, err)
	require.Equal(t, 3, primero.Publicados)

	// El segundo barrido del mismo día consulta al Simulador otra vez —el estado puede
	// haber cambiado— y no publica nada: los identificadores son los mismos y la clave
	// primaria del outbox los descarta.
	segundo, err := sweeper.SweepIndicators(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, segundo.Publicados)
	require.Equal(t, 3, segundo.Repetidos)
	require.Equal(t, 3, len(store.rows), "no puede haber una fila por barrido")
	require.Equal(t, 2, sim.calendarCalls, "se consulta en cada vuelta: el estado puede cambiar")
}

func TestAlertEventChangesWithTheDay(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	sweeper, _ := sweeperDePrueba(calendarioConHuecos(), store, testAlertEmail)

	_, err := sweeper.SweepIndicators(context.Background())
	require.NoError(t, err)
	primerID := store.rows[0].ID

	// Al día siguiente el aviso se vuelve a emitir: es lo que hace que el problema siga
	// siendo visible sin ser machacón. Si el identificador no cambiara, un indicador sin
	// vigencia se avisaría una sola vez y para siempre.
	sweeper.now = func() time.Time {
		return time.Date(2026, 6, 16, 3, 0, 0, 0, time.UTC)
	}
	_, err = sweeper.SweepIndicators(context.Background())
	require.NoError(t, err)

	require.Equal(t, 6, len(store.rows))
	require.NotEqual(t, primerID, store.rows[1*3].ID)
}

func TestSweepWithNothingToReportPublishesNothing(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	sweeper, _ := sweeperDePrueba(&simulatorv1.IndicatorCalendarStatus{}, store, testAlertEmail)

	resumen, err := sweeper.SweepIndicators(context.Background())
	require.NoError(t, err)

	require.Equal(t, 0, resumen.Publicados)
	require.Equal(t, 0, store.inserts, "ni siquiera se toca el outbox cuando no hay nada que avisar")
}

func TestSweepWithoutMailboxDoesNotPublish(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	sweeper, _ := sweeperDePrueba(calendarioConHuecos(), store, "")

	resumen, err := sweeper.SweepIndicators(context.Background())
	require.NoError(t, err)

	// Sin buzón configurado el barrido sigue MIRANDO —y lo deja en el log— pero no encola
	// correos que no se pueden entregar. Fallar al arrancar por una dirección que falta
	// tumbaría al Orquestador por un aviso operativo.
	require.Equal(t, 0, resumen.Publicados)
	require.Empty(t, store.rows)
}

func TestSweepReportsTheSimulatorFailure(t *testing.T) {
	t.Parallel()

	sweeper, sim := sweeperDePrueba(calendarioConHuecos(), &fakeStore{}, testAlertEmail)
	sim.err = status.Error(codes.Unavailable, "sin conexión")

	_, err := sweeper.SweepIndicators(context.Background())
	require.Error(t, err)
	require.Contains(t, err.Error(), "estado del calendario")
}

// TestSweepDistinguishesAnOlderSimulator: un `Unimplemented` no es una caída, es una
// versión del Simulador sin los RPC de indicadores. El mensaje tiene que decirlo, porque el
// diagnóstico que lleva a la causa es completamente distinto.
func TestSweepDistinguishesAnOlderSimulator(t *testing.T) {
	t.Parallel()

	sweeper, sim := sweeperDePrueba(calendarioConHuecos(), &fakeStore{}, testAlertEmail)
	sim.err = status.Error(codes.Unimplemented, "pendiente de T104")

	_, err := sweeper.SweepIndicators(context.Background())
	require.Error(t, err)
	require.Contains(t, err.Error(), "versión anterior")
}

func TestSweepSurfacesTheStoreFailure(t *testing.T) {
	t.Parallel()

	store := &fakeStore{err: errors.New("outbox no responde")}
	sweeper, _ := sweeperDePrueba(calendarioConHuecos(), store, testAlertEmail)

	// Un outbox que no acepta la escritura tiene que llegar al log del barrido: si se
	// tragara, el aviso no se emitiría y el barrido diría que todo está en orden.
	_, err := sweeper.SweepIndicators(context.Background())
	require.Error(t, err)
	require.Contains(t, err.Error(), "outbox no responde")
}

func TestAlertPayloadIsAWellFormedEnvelope(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	sweeper, _ := sweeperDePrueba(calendarioConHuecos(), store, testAlertEmail)
	_, err := sweeper.SweepIndicators(context.Background())
	require.NoError(t, err)

	// El payload del outbox es el SOBRE del catálogo serializado: sus consumidores leen
	// `event_id` como clave de idempotencia y `event_type` para decidir qué hacer, así que
	// un sobre mal formado no da error —se descarta— y el correo no llega.
	var sobre events.Envelope
	require.NoError(t, json.Unmarshal(store.rows[0].Payload, &sobre))

	require.Equal(t, events.EventIndicatorCalendarAlert, sobre.EventType)
	require.Equal(t, store.rows[0].ID.String(), sobre.EventID)
	require.Equal(t, uuid.Nil.String(), sobre.ActorRef, "un aviso del sistema no tiene titular")
	require.NotEmpty(t, sobre.OccurredAt)
}

// ── ayudas ──────────────────────────────────────────────────────────────────

func payloadOf(t *testing.T, row storer.OutboxRow) map[string]any {
	t.Helper()
	var sobre events.Envelope
	require.NoError(t, json.Unmarshal(row.Payload, &sobre))
	return sobre.Payload
}

func nameOf(t *testing.T, row storer.OutboxRow) string {
	t.Helper()
	name, _ := payloadOf(t, row)["name"].(string)
	return name
}

func kindOf(t *testing.T, row storer.OutboxRow) string {
	t.Helper()
	kind, _ := payloadOf(t, row)["kind"].(string)
	return kind
}
