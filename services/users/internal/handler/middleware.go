package handler

import (
	"context"
	"log/slog"
	"runtime/debug"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Interceptores gRPC: la parte transversal del transporte.
//
// Están en `handler` y no en `main.go` porque son transporte, y no en `server`
// porque un interceptor razona sobre métodos gRPC y códigos de estado, que la
// capa de aplicación no conoce. `main.go` solo los enchufa.
//
// El observability completo —métricas de latencia, tasa de error y throughput,
// más `/healthz` y `/readyz`— es T067. Aquí queda el mínimo que ya se necesita
// para operar el esqueleto: no perder un panic y poder ver qué se llamó.

// UnaryInterceptors devuelve la cadena en el orden en que debe aplicarse.
//
// El orden importa y no es arbitrario: la recuperación va PRIMERO (es decir, más
// externa) para que también cubra un panic dentro del propio interceptor de log.
// Al revés, un fallo en el log tumbaría el proceso.
func UnaryInterceptors(logger *slog.Logger) []grpc.UnaryServerInterceptor {
	return []grpc.UnaryServerInterceptor{
		recoverUnary(logger),
		logUnary(logger),
	}
}

// recoverUnary convierte un panic en un error `Internal` en lugar de tumbar el
// proceso.
//
// Un panic en un solo RPC no debe cortar las conexiones de todos los demás
// clientes: en un servicio con réplicas, un panic reproducible por una entrada
// concreta convertiría un fallo de una petición en una caída en cascada de todas
// las réplicas a las que llegue esa entrada.
//
// El stack trace va al log, NUNCA a la respuesta: puede contener rutas internas y
// valores de argumentos.
func recoverUnary(logger *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, next grpc.UnaryHandler) (resp any, err error) {
		defer func() {
			if r := recover(); r != nil {
				logger.ErrorContext(ctx, "panic en un RPC",
					slog.String("method", info.FullMethod),
					slog.Any("panic", r),
					slog.String("stack", string(debug.Stack())),
				)
				err = status.Error(codes.Internal, "error interno")
			}
		}()
		//nolint:wrapcheck // el interceptor debe devolver el error del handler
		// intacto: envolverlo cambiaría el código de estado que recibe el cliente.
		return next(ctx, req)
	}
}

// logUnary emite una línea JSON estructurada por RPC (D-12, §Observabilidad).
//
// Registra el método, la duración y el código de estado; NO registra el mensaje de
// petición. La tentación de volcar `req` es fuerte al depurar, pero este servicio
// maneja correos y nombres, y un log con datos personales es un incidente de
// privacidad que sobrevive en la retención de logs mucho más que el bug que se
// estaba buscando (FR-030 obliga a poder anonimizar; un log no se anonimiza).
func logUnary(logger *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, next grpc.UnaryHandler) (any, error) {
		start := time.Now()
		//nolint:wrapcheck // ver recoverUnary: el error del handler pasa intacto.
		resp, err := next(ctx, req)

		attrs := []slog.Attr{
			slog.String("method", info.FullMethod),
			slog.Duration("duration", time.Since(start)),
			slog.String("code", status.Code(err).String()),
		}
		if err != nil {
			// El error completo (con su causa envuelta) va al log; al cliente solo
			// llega el mensaje saneado que produce `grpcError`.
			attrs = append(attrs, slog.String("error", err.Error()))
			logger.LogAttrs(ctx, slog.LevelError, "RPC fallido", attrs...)
			return resp, err
		}
		logger.LogAttrs(ctx, slog.LevelInfo, "RPC atendido", attrs...)
		return resp, nil
	}
}
