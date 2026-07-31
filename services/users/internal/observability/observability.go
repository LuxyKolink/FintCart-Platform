// Observabilidad común del servicio (§Observabilidad, research D-12).
//
// Reúne las tres cosas que la constitución exige de todos los servicios y que, si se
// dejan a cada `main.go`, acaban distintas en cada uno:
//
//  1. **Logs estructurados JSON.** Los ocho servicios escriben a stdout y un colector
//     los agrega; con texto libre haría falta una expresión regular por servicio, y se
//     rompe la primera vez que alguien cambia una palabra del mensaje.
//  2. **Métricas** de latencia, tasa de error y throughput, en `/metrics`.
//  3. **Sondas `/healthz` y `/readyz`**, que NO son lo mismo (ver [Probes]).
//
// Que un servicio gRPC abra un puerto HTTP no contradice el Principio II: no hay
// superficie REST de negocio, son sondas de infraestructura en un puerto aparte y no
// exponen ningún dato de dominio.
package observability

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/status"
)

// DefaultHealthPort es el puerto de las sondas cuando `HEALTH_PORT` no está.
//
// Tiene valor por defecto —al contrario que el puerto de servicio, que es
// obligatorio— porque un despliegue que lo olvide debe quedarse sin sondas, no sin
// arrancar: negarse a levantar el servicio por su puerto de DIAGNÓSTICO invertiría
// la relación entre el servicio y lo que lo observa.
const DefaultHealthPort = "8080"

// Service identifica a este proceso en las métricas y en los logs.
const Service = "users"

// NewLogger construye el log JSON del servicio.
//
// Un nivel ilegible cae a `info` en lugar de silenciar el proceso: un `LOG_LEVEL` mal
// escrito no puede dejar un servicio sin observabilidad justo cuando haga falta.
func NewLogger(level string) *slog.Logger {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(level)); err != nil {
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl})).
		With(slog.String("service", Service))
}

// ── métricas ────────────────────────────────────────────────────────────────

// latencyBuckets cubre desde una llamada interna rápida hasta un participante lento.
//
// Las cotas están elegidas alrededor de los objetivos de rendimiento (SC-002/SC-006,
// respuesta en menos de 500 ms): sin una cota cerca del umbral que se vigila, el
// percentil caería siempre dentro del mismo intervalo y la métrica no distinguiría
// cumplirlo de incumplirlo.
//
// El `nolint` es correcto y no un atajo: la prohibición de `float64` del Principio VIII
// es sobre DINERO y TASAS, y esto son segundos de latencia. Prometheus define sus cotas
// en `float64` y no admite otro tipo, así que la alternativa no sería un decimal exacto
// sino no tener histograma.
//
//nolint:forbidigo // Segundos de latencia, no importes: ver arriba.
var latencyBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

var (
	// requestsTotal da throughput y tasa de error a la vez: son la misma cuenta
	// partida por `code`. Dos contadores independientes podrían discrepar.
	requestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace:   "fintcart",
		Name:        "requests_total",
		Help:        "Peticiones atendidas, por operación y código de resultado.",
		ConstLabels: prometheus.Labels{"service": Service},
	}, []string{"operation", "code"})

	requestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace:   "fintcart",
		Name:        "request_duration_seconds",
		Help:        "Latencia de las operaciones atendidas.",
		Buckets:     latencyBuckets,
		ConstLabels: prometheus.Labels{"service": Service},
	}, []string{"operation"})
)

// Observe registra el desenlace y la duración de una operación cualquiera.
//
// Existe para lo que no pasa por gRPC ni por HTTP —un mensaje consumido de RabbitMQ, un
// barrido del outbox—, que de otro modo quedaría fuera de las métricas por el mero
// hecho de no tener un transporte con interceptor.
func Observe(operation, code string, elapsed time.Duration) {
	requestsTotal.WithLabelValues(operation, code).Inc()
	requestDuration.WithLabelValues(operation).Observe(elapsed.Seconds())
}

// UnaryServerInterceptor mide cada RPC.
//
// Se registra DESPUÉS del interceptor de log en la cadena para que mida también lo que
// este último añade: una métrica que excluyera el propio middleware describiría un
// servicio que no existe.
func UnaryServerInterceptor() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req any,
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (any, error) {
		start := time.Now()
		resp, err := handler(ctx, req)
		Observe(info.FullMethod, status.Code(err).String(), time.Since(start))
		return resp, err //nolint:wrapcheck // El interceptor no debe alterar el error del handler.
	}
}

// ── sondas ──────────────────────────────────────────────────────────────────

// ReadyFunc comprueba si el servicio puede trabajar.
type ReadyFunc func(ctx context.Context) error

// Probes es el servidor de sondas y métricas.
type Probes struct {
	srv    *http.Server
	logger *slog.Logger
}

// readyTimeout acota la comprobación de readiness.
//
// Sin plazo, una base que acepta la conexión y no responde dejaría la sonda colgada, y
// Kubernetes la interpretaría como fallo por timeout de todas formas — pero varios
// segundos más tarde y sin nada en el log que lo explicara.
const readyTimeout = 3 * time.Second

// NewProbes construye el servidor de sondas.
//
// La distinción entre las dos sondas es la que evita el peor fallo operativo posible:
// si `/healthz` comprobara la base de datos, una caída de PostgreSQL reiniciaría TODAS
// las réplicas a la vez y, al volver, la base se encontraría con un enjambre de
// procesos arrancando en frío en lugar de con réplicas listas para reanudar.
//
//   - `/healthz` — ¿el proceso está vivo? Kubernetes REINICIA el pod si falla.
//   - `/readyz`  — ¿puede trabajar? Kubernetes le QUITA TRÁFICO si falla.
func NewProbes(port string, logger *slog.Logger, ready ReadyFunc) *Probes {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		// Vivacidad: no consulta ninguna dependencia. Ver el comentario de arriba.
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok\n"))
	})

	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), readyTimeout)
		defer cancel()

		if err := ready(ctx); err != nil {
			logger.WarnContext(ctx, "sonda de readiness negativa", slog.String("error", err.Error()))
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("not ready\n"))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ready\n"))
	})

	mux.Handle("/metrics", promhttp.Handler())

	return &Probes{
		srv: &http.Server{
			Addr:              ":" + port,
			Handler:           mux,
			ReadHeaderTimeout: readyTimeout,
		},
		logger: logger,
	}
}

// Run sirve las sondas hasta que se cancele el contexto.
//
// Un fallo del servidor de sondas NO debe tumbar el proceso: sin `/readyz`, Kubernetes
// deja de mandarle tráfico, que es exactamente la degradación deseada. Matar el
// servicio porque su puerto de diagnóstico no arrancó sería convertir un problema de
// observabilidad en una caída.
func (p *Probes) Run(ctx context.Context) {
	var lc net.ListenConfig
	lis, err := lc.Listen(ctx, "tcp", p.srv.Addr)
	if err != nil {
		p.logger.ErrorContext(ctx, "no se pudieron abrir las sondas de salud",
			slog.String("addr", p.srv.Addr), slog.String("error", err.Error()))
		return
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), readyTimeout)
		defer cancel()
		_ = p.srv.Shutdown(shutdownCtx)
	}()

	p.logger.InfoContext(ctx, "sondas de salud escuchando", slog.String("addr", p.srv.Addr))
	if err := p.srv.Serve(lis); err != nil && !errors.Is(err, http.ErrServerClosed) {
		p.logger.ErrorContext(ctx, "el servidor de sondas terminó con error",
			slog.String("error", err.Error()))
	}
}
