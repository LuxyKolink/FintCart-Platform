package handler

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/fintcart/platform/services/orchestrator/internal/server"
)

// `mapping_test` es del paquete `handler` y no de `handler_test`: `grpcError` no se exporta, y la
// traducción de errores es justo lo que hay que poder probar sin levantar un servidor.

// El rechazo de un participante llega al cliente con SU mensaje, no con la cadena de la saga.
//
// Es el defecto que se midió contra la pila real: una ejecución rechazada por la regla `monto >
// 1000` —cuyo mensaje escribió el autor de la calculadora— respondía con
// «server: argumento inválido: server: saga fallida y compensada (simulacion): paso 0
// (simulator.compute): ejecutar la simulación de <uuid>: rpc error: code = InvalidArgument desc =
// …». El motivo estaba al final, detrás de nombres internos y de un identificador de usuario.
func TestGrpcErrorKeepsTheParticipantsMessage(t *testing.T) {
	t.Parallel()

	// La forma real: el paso de la saga envuelve el error del servicio interno, que es un estado
	// de gRPC, y la capa de este servicio envuelve el fallo de la saga con su centinela.
	rechazo := status.Error(codes.InvalidArgument, "El monto tiene que superar 1000")
	paso := fmt.Errorf("paso %d (%s): %w", 0, "simulator.compute", rechazo)
	saga := fmt.Errorf("%w (%s): %w", server.ErrSagaFailed, "simulacion", paso)
	err := fmt.Errorf("%w: %w", server.ErrInvalidArgument, saga)

	traducido := grpcError(err)
	st, ok := status.FromError(traducido)
	require.True(t, ok)

	require.Equal(t, codes.InvalidArgument, st.Code())
	require.Equal(t, "El monto tiene que superar 1000", st.Message())
	// Y NO arrastra el rastro técnico: ni el nombre del paso, ni el identificador, ni el prefijo
	// que gRPC pone a los errores de un cliente.
	require.NotContains(t, st.Message(), "saga fallida")
	require.NotContains(t, st.Message(), "simulator.compute")
	require.NotContains(t, st.Message(), "rpc error")
}

// Una petición mal formada de ESTE servicio conserva su mensaje: no hay causa que desenvolver.
func TestGrpcErrorKeepsItsOwnMessage(t *testing.T) {
	t.Parallel()

	err := fmt.Errorf("%w: saga_id %q no es un UUID", server.ErrInvalidArgument, "no-es-uuid")

	st, ok := status.FromError(grpcError(err))
	require.True(t, ok)
	require.Equal(t, codes.InvalidArgument, st.Code())
	require.Contains(t, st.Message(), "no es un UUID")
}

// El código del participante MANDA sobre el del centinela: un rechazo por estado —409— no puede
// convertirse en un 400 por el camino.
func TestGrpcErrorKeepsTheParticipantsCode(t *testing.T) {
	t.Parallel()

	rechazo := status.Error(codes.FailedPrecondition, "la sesión ya está cerrada")
	err := fmt.Errorf("%w: %w", server.ErrInvalidArgument, rechazo)

	st, ok := status.FromError(grpcError(err))
	require.True(t, ok)
	require.Equal(t, codes.FailedPrecondition, st.Code())
	require.Equal(t, "la sesión ya está cerrada", st.Message())
}
