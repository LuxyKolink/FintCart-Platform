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

// Interceptores gRPC del Orquestador.
//
// Son casi idénticos a los de los demás servicios Go, y la duplicación es
// deliberada: `contracts/` es la ÚNICA superficie compartida de la plataforma y
// contiene contratos, no código (Principio I / §Definición de Contratos). Un
// paquete común de utilidades sería una dependencia compartida más, capaz de
// acoplar el despliegue de ocho servicios a un cambio en una función de log.
// Sesenta líneas repetidas cuestan menos que ese acoplamiento.
//
// El observability completo —métricas y sondas— es T067.

// UnaryInterceptors devuelve la cadena en el orden en que debe aplicarse: la
// recuperación primero (más externa), para que cubra también un panic del propio
// interceptor de log.
func UnaryInterceptors(logger *slog.Logger) []grpc.UnaryServerInterceptor {
	return []grpc.UnaryServerInterceptor{
		recoverUnary(logger),
		logUnary(logger),
	}
}

// recoverUnary convierte un panic en `Internal` en lugar de tumbar el proceso.
//
// Importa especialmente aquí: un panic a mitad de una saga deja pasos aplicados sin
// compensar. Recuperarlo permite que el estado persistido en `saga_state` siga
// siendo la verdad y que la reanudación pueda retomar el flujo.
//
// El stack trace va al log, nunca a la respuesta: los argumentos que aparecerían en
// un trace de `StartRegistration` incluyen una contraseña en claro.
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
// Registra método, duración y código de estado. NO registra el mensaje de
// petición: `StartRegistration` transporta la contraseña en claro camino de Auth, y
// volcarla al log la dejaría almacenada durante toda la retención.
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
			// El error completo (con su causa) va al log; al cliente solo llega el
			// mensaje saneado que produce `grpcError`.
			attrs = append(attrs, slog.String("error", err.Error()))
			logger.LogAttrs(ctx, slog.LevelError, "RPC fallido", attrs...)
			return resp, err
		}
		logger.LogAttrs(ctx, slog.LevelInfo, "RPC atendido", attrs...)
		return resp, nil
	}
}
