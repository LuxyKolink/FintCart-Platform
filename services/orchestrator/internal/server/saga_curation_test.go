package server

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/common/v1"
	simulatorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/simulator/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/server/steps"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Prueba de la saga de CURADURÍA (T115, FR-053).
//
// Existe por la misma razón de GOBIERNO que la de simulación: el Simulador no es productor de
// eventos (Principio V), y una calculadora que aparece en el catálogo público tiene que dejar
// rastro de quién la aprobó y cuándo. Lo que se comprueba aquí, y no en el Simulador, es que el
// evento se emite DESPUÉS de aprobar, que lleva la versión PUBLICADA —no la que alguien creyó
// aprobar— y que una aprobación rechazada no deja evento ninguno.

const (
	curCalculator  = "33333333-3333-4333-8333-333333333333"
	curOwner       = "44444444-4444-4444-8444-444444444444"
	curCoordinator = "55555555-5555-4555-8555-555555555555"
)

// fakeCurator dobla al Simulador en lo que la curaduría usa: aprobar y leer lo aprobado.
type fakeCurator struct {
	simulatorv1.SimulatorServiceClient

	approveErr error
	// getErr simula el fallo de la lectura POSTERIOR a la aprobación: es el caso incómodo, el
	// que deja la calculadora publicada y sin evento.
	getErr error

	approved []*simulatorv1.ApproveCalculatorRequest
	reads    []*simulatorv1.CalculatorRef

	// version es la que devuelve el Simulador al leer. La prueba la fija para poder comprobar
	// que el evento lleva ESA y no una que el Orquestador hubiera supuesto.
	version int32
}

func (f *fakeCurator) ApproveCalculator(
	_ context.Context, req *simulatorv1.ApproveCalculatorRequest, _ ...grpc.CallOption,
) (*commonv1.OpResult, error) {
	if f.approveErr != nil {
		return nil, f.approveErr
	}
	f.approved = append(f.approved, req)
	return &commonv1.OpResult{Success: true}, nil
}

func (f *fakeCurator) GetCalculator(
	_ context.Context, req *simulatorv1.CalculatorRef, _ ...grpc.CallOption,
) (*simulatorv1.Calculator, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	f.reads = append(f.reads, req)
	return &simulatorv1.Calculator{
		CalculatorId: curCalculator,
		OwnerId:      curOwner,
		State:        "publicada",
		Version:      f.version,
	}, nil
}

func newCurationEngine(store storer.Storer, curator *fakeCurator) *Engine {
	return newTestEngine(store, steps.CurationDefinition(steps.Clients{Simulator: curator}))
}

// El camino feliz: aprueba, lee lo publicado y emite el evento con esos datos.
func TestApprovalPublishesTheApprovedVersion(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	curator := &fakeCurator{version: 3}

	out, err := New(newCurationEngine(store, curator)).
		ApproveCalculator(context.Background(), curCalculator, curCoordinator)
	require.NoError(t, err)

	require.Equal(t, curCalculator, out.CalculatorID)
	require.Equal(t, int32(3), out.Version, "la versión que se devuelve es la publicada")

	require.Len(t, curator.approved, 1)
	require.Equal(t, curCoordinator, curator.approved[0].GetCoordinatorId())

	// La lectura va DESPUÉS de la aprobación y como el COORDINADOR: si se leyera como el autor,
	// el Simulador devolvería el borrador y el evento anunciaría una versión que no se publicó.
	require.Len(t, curator.reads, 1)
	require.Equal(t, curCoordinator, curator.reads[0].GetActorId())

	require.Len(t, store.events, 1)
	evento := store.events[0]
	require.Equal(t, events.EventCalculatorPublished, evento.EventType)

	// El payload del outbox es el SOBRE completo, no solo el contenido del evento: se lee como
	// texto, igual que hace la prueba de simulación, porque lo que importa no es la forma del
	// JSON —eso lo fija el motor— sino qué datos viajan dentro.
	payload := string(evento.Payload)
	require.Contains(t, payload, curCalculator)
	require.Contains(t, payload, `"version":3`)
	require.Contains(t, payload, curOwner, "el autor viaja como referencia opaca")
	require.Contains(t, payload, `"actor_ref":"`+curCoordinator+`"`,
		"el actor del evento es quien aprobó")
	require.Equal(t, storer.StatusCompleted, store.row(t, onlySaga(t, store)).Status)
}

// Un rechazo del Simulador no deja evento: la curaduría no ocurrió.
func TestRejectedApprovalEmitsNothing(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	curator := &fakeCurator{
		approveErr: status.Error(codes.PermissionDenied, "nadie aprueba su propia calculadora"),
	}

	_, err := New(newCurationEngine(store, curator)).
		ApproveCalculator(context.Background(), curCalculator, curCoordinator)

	require.Error(t, err)
	// Dos propiedades a la vez, y las dos importan. El centinela interno clasifica el fallo como
	// error del llamante; y el código gRPC del Simulador se CONSERVA en lugar de degradarse a
	// `Internal`, de modo que el borde del Gateway lo traduce a **403** —el que el contrato
	// promete para FR-053— y no a un 500 que mandaría al coordinador a reintentar algo que no le
	// corresponde.
	require.ErrorIs(t, err, ErrInvalidArgument)
	require.Equal(t, codes.PermissionDenied, status.Code(err),
		"el 403 del Simulador tiene que sobrevivir al envoltorio")
	require.Empty(t, store.events, "sin aprobación no hay nada que auditar")
	require.Equal(t, storer.StatusFailed, store.row(t, onlySaga(t, store)).Status)
}

// Aprobar sin `coordinator_id` es un error del LLAMANTE, no una saga rota.
func TestApprovalNeedsBothIdentifiers(t *testing.T) {
	t.Parallel()
	store := newMemStore()

	for _, caso := range []struct{ calculadora, coordinador string }{
		{"", curCoordinator},
		{curCalculator, ""},
	} {
		_, err := New(newCurationEngine(store, &fakeCurator{version: 1})).
			ApproveCalculator(context.Background(), caso.calculadora, caso.coordinador)
		require.Error(t, err)
		// Se comprueba el centinela y no el código gRPC: esta prueba llama a la capa de
		// aplicación directamente, y traducir a un código de transporte es trabajo del
		// handler (`grpcError`), que tiene sus propias pruebas.
		require.ErrorIs(t, err, ErrInvalidArgument)
	}
	require.Empty(t, store.events)
}

// Si la lectura posterior falla, la calculadora queda publicada y SIN evento.
//
// Es el caso incómodo, y la respuesta correcta no es compensar: deshacer una aprobación
// significaría retirar del catálogo una versión que un coordinador aprobó. Queda la saga fallida
// —visible, reanudable— y la ausencia del evento, que es un hueco que se puede ver; una
// despublicación silenciosa no.
func TestApprovalSurvivesAFailedReadButLeavesNoEvent(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	curator := &fakeCurator{
		getErr:  status.Error(codes.NotFound, "no encontrada"),
		version: 1,
	}

	_, err := New(newCurationEngine(store, curator)).
		ApproveCalculator(context.Background(), curCalculator, curCoordinator)

	require.Error(t, err)
	require.Len(t, curator.approved, 1, "la aprobación SÍ ocurrió")
	require.Empty(t, store.events, "y su evento no se emitió: hay que poder verlo")
	require.Equal(t, storer.StatusFailed, store.row(t, onlySaga(t, store)).Status)
}

// El payload del evento NO lleva la definición ni el nombre.
//
// `audit_log` es append-only: lo que entre ahí no se puede retirar. Acreditar la aprobación
// necesita la calculadora, la versión y los dos actores; el contenido de la fórmula es del
// Simulador, que ya lo tiene.
func TestPublishedEventCarriesOnlyWhatAuditsTheApproval(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	curator := &fakeCurator{version: 7}

	_, err := New(newCurationEngine(store, curator)).
		ApproveCalculator(context.Background(), curCalculator, curCoordinator)
	require.NoError(t, err)

	require.Len(t, store.events, 1)
	payload := store.events[0].Payload
	for _, ausente := range []string{"definition", "inputs", "outputs", "name", "description"} {
		require.NotContains(t, string(payload), ausente,
			"el payload de auditoría no debe llevar %q", ausente)
	}
}
