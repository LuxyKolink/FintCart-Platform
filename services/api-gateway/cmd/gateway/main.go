// Entrypoint del API Gateway (Principio X: «entrypoint delgado»).
//
// El Gateway es el ÚNICO componente con superficie REST (Principio II) y no tiene ni
// dominio ni base de datos (plan.md N-01), así que su ensamblaje no es
// `storer → server → handler` sino `clientes gRPC + Redis → handler → router`.
//
// Lo que sí tiene, y no tiene ningún otro servicio, es un servidor HTTP expuesto al
// exterior. Por eso este archivo fija plazos en el `http.Server`: un servidor gRPC
// interno habla con pares conocidos, mientras que aquí una conexión que abre el
// socket y no envía nada es un recurso retenido gratis, y unas cuantas miles tumban
// el proceso sin necesidad de tráfico real.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/fintcart/platform/services/api-gateway/internal/authn"
	"github.com/fintcart/platform/services/api-gateway/internal/grpcclient"
	"github.com/fintcart/platform/services/api-gateway/internal/handler"
	"github.com/fintcart/platform/services/api-gateway/internal/observability"
	"github.com/fintcart/platform/services/api-gateway/internal/ratelimit"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "gateway: fallo fatal: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}

	logger := observability.NewLogger(cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Redis: rate limiting y consulta de la blacklist de JWT. Son los dos únicos usos
	// permitidos en el Gateway (Principio IV), y ninguno es fuente de verdad.
	redisClient := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
	defer closeQuietly(logger, "conexión con Redis", redisClient.Close)

	pingCtx, cancelPing := context.WithTimeout(ctx, dependencyProbeTimeout)
	defer cancelPing()
	if err := redisClient.Ping(pingCtx).Err(); err != nil {
		return fmt.Errorf("comprobar la conexión con Redis: %w", err)
	}

	clients, err := grpcclient.Dial(grpcclient.Config{
		AuthAddr:         cfg.AuthAddr,
		UsersAddr:        cfg.UsersAddr,
		LearningAddr:     cfg.LearningAddr,
		SimulatorAddr:    cfg.SimulatorAddr,
		OrchestratorAddr: cfg.OrchestratorAddr,
	})
	if err != nil {
		return fmt.Errorf("abrir los clientes gRPC internos: %w", err)
	}
	defer closeQuietly(logger, "clientes gRPC internos", clients.Close)

	verifier, err := authn.NewJWTVerifier(cfg.JWTAlgorithm, cfg.JWTKey)
	if err != nil {
		return fmt.Errorf("construir el verificador de JWT: %w", err)
	}

	limiter := ratelimit.NewRedisLimiter(redisClient, ratelimit.Config{
		Limit:  cfg.RateLimitPerMinute,
		Window: time.Minute,
		// FAIL CLOSED. Con `true`, una caída de Redis dejaría el borde sin ninguna
		// protección de tasa justo cuando la plataforma ya está degradada.
		FailOpen: false,
	})

	h := handler.New(clients, logger)
	router := h.Routes(handler.Deps{
		Verifier:    verifier,
		Blacklist:   authn.NewRedisBlacklist(redisClient),
		Limiter:     limiterAdapter{limiter},
		CORSOrigins: cfg.CORSOrigins,
	})

	// Las sondas viven en su propio puerto: si compartieran el del borde, retirar
	// tráfico del pod por `/readyz` también dejaría a Kubernetes sin poder
	// consultarlo. Y en el Gateway hay una segunda razón — el puerto del borde está
	// expuesto al exterior, y las métricas internas no deben estarlo.
	//
	// La readiness comprueba Redis porque sin él el borde falla CERRADO: el rate
	// limiting rechaza todo y la blacklist da por revocada cualquier sesión. Un
	// Gateway en ese estado responde, pero solo con errores, así que es mejor que deje
	// de recibir tráfico.
	go observability.NewProbes(cfg.HealthPort, logger, func(probeCtx context.Context) error {
		if err := redisClient.Ping(probeCtx).Err(); err != nil {
			return fmt.Errorf("no hay conexión con Redis: %w", err)
		}
		return nil
	}).Run(ctx)

	srv := &http.Server{
		Addr:    ":" + cfg.HTTPPort,
		Handler: router,
		// Plazos del borde. `ReadHeaderTimeout` es el que cierra el Slowloris clásico
		// —una conexión que envía la cabecera byte a byte— y `IdleTimeout` el que evita
		// que las conexiones keep-alive se acumulen sin límite.
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}

	return serve(ctx, logger, srv)
}

// serve arranca el servidor HTTP y lo detiene ordenadamente.
func serve(ctx context.Context, logger *slog.Logger, srv *http.Server) error {
	errCh := make(chan error, 1)
	go func() {
		logger.Info("api gateway escuchando", slog.String("addr", srv.Addr))
		// `ErrServerClosed` es el resultado NORMAL de `Shutdown`, no un fallo: tratarlo
		// como error haría que cada parada limpia se registrara como caída.
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("servir HTTP: %w", err)
			return
		}
		errCh <- nil
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		logger.Info("señal de parada recibida; apagado ordenado")
	}

	// `Shutdown` deja terminar las peticiones en vuelo. El plazo acota cuánto se
	// espera: sin él, una petición colgada mantendría el proceso vivo hasta que el
	// orquestador lo matara con SIGKILL, cortando también las demás.
	//
	// `WithoutCancel` y no `context.Background()`: hereda los valores del contexto de
	// arranque —trazas, identificadores de despliegue— pero NO su cancelación, que a
	// estas alturas ya se disparó. Sin el `WithoutCancel`, el contexto llegaría
	// cancelado y `Shutdown` cerraría de golpe justo lo que se quería drenar.
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("apagado ordenado del servidor HTTP: %w", err)
	}
	logger.Info("apagado ordenado completado")
	return <-errCh
}

// limiterAdapter traduce `ratelimit.Decision` a `handler.Decision`.
//
// Los dos tipos son idénticos campo a campo y aun así no se comparten: `handler`
// declara el puerto que necesita y `ratelimit` expone su propio resultado, de modo
// que ninguno importa al otro (Principio IX). El precio de esa independencia son
// estas cuatro líneas de traducción, y el sitio donde tienen que estar es el
// ensamblaje —aquí—, porque es el único punto que conoce a los dos.
type limiterAdapter struct {
	inner ratelimit.Limiter
}

func (a limiterAdapter) Allow(ctx context.Context, key string) (handler.Decision, error) {
	d, err := a.inner.Allow(ctx, key)
	if err != nil {
		return handler.Decision{}, err //nolint:wrapcheck // adaptador de tipos: envolver aquí solo añadiría ruido al mensaje que ya trae `ratelimit`.
	}
	return handler.Decision{
		Allowed:    d.Allowed,
		Remaining:  d.Remaining,
		RetryAfter: d.RetryAfter,
	}, nil
}

// ── Configuración ───────────────────────────────────────────────────────────

const (
	shutdownTimeout        = 20 * time.Second
	dependencyProbeTimeout = 5 * time.Second

	readHeaderTimeout = 5 * time.Second
	readTimeout       = 15 * time.Second
	writeTimeout      = 30 * time.Second
	idleTimeout       = 60 * time.Second

	// defaultRateLimitRPM se usa si `RATE_LIMIT_RPM` no viene definido. Tiene valor
	// por defecto —a diferencia de las direcciones— porque su ausencia no es
	// ambigua: el límite debe existir siempre, y arrancar SIN límite por una variable
	// olvidada sería el fallo peligroso.
	defaultRateLimitRPM int64 = 600
)

type config struct {
	RedisAddr        string
	AuthAddr         string
	UsersAddr        string
	LearningAddr     string
	SimulatorAddr    string
	OrchestratorAddr string
	HTTPPort         string
	HealthPort       string
	LogLevel         string

	CORSOrigins        []string
	RateLimitPerMinute int64

	// JWTKey es un SECRETO cuando el algoritmo es simétrico. No se registra ni se
	// devuelve en ningún error.
	JWTKey       string
	JWTAlgorithm authn.Algorithm
}

var (
	errMissingEnv = errors.New("falta una variable de entorno obligatoria")
	errBadEnv     = errors.New("variable de entorno con formato inválido")
)

func loadConfig() (config, error) {
	cfg := config{
		RedisAddr:        os.Getenv("REDIS_ADDR"),
		AuthAddr:         os.Getenv("AUTH_SVC_ADDR"),
		UsersAddr:        os.Getenv("USERS_SVC_ADDR"),
		LearningAddr:     os.Getenv("LEARNING_SVC_ADDR"),
		SimulatorAddr:    os.Getenv("SIMULATOR_SVC_ADDR"),
		OrchestratorAddr: os.Getenv("ORCHESTRATOR_SVC_ADDR"),
		HTTPPort:         os.Getenv("HTTP_PORT"),
		HealthPort:       os.Getenv("HEALTH_PORT"),
		LogLevel:         os.Getenv("LOG_LEVEL"),
	}

	// Clave de verificación: se prefiere la PÚBLICA (asimétrica). El algoritmo lo
	// decide la variable que esté presente y NUNCA el token — ver `authn.Algorithm`.
	//
	// `JWT_SIGNING_KEY` es el camino de desarrollo que usa hoy
	// `dev/docker-compose.yaml`, donde Auth y Gateway comparten un secreto HS256. En
	// cualquier otro entorno debe definirse `JWT_PUBLIC_KEY` (ver la salvedad de
	// `authn.JWTVerifier`).
	switch {
	case os.Getenv("JWT_PUBLIC_KEY") != "":
		cfg.JWTKey = os.Getenv("JWT_PUBLIC_KEY")
		cfg.JWTAlgorithm = authn.AlgRS256
	default:
		cfg.JWTKey = os.Getenv("JWT_SIGNING_KEY")
		cfg.JWTAlgorithm = authn.AlgHS256
	}

	if cfg.HealthPort == "" {
		cfg.HealthPort = observability.DefaultHealthPort
	}

	missing := make([]string, 0, 8)
	for name, value := range map[string]string{
		"REDIS_ADDR":                       cfg.RedisAddr,
		"AUTH_SVC_ADDR":                    cfg.AuthAddr,
		"USERS_SVC_ADDR":                   cfg.UsersAddr,
		"LEARNING_SVC_ADDR":                cfg.LearningAddr,
		"SIMULATOR_SVC_ADDR":               cfg.SimulatorAddr,
		"ORCHESTRATOR_SVC_ADDR":            cfg.OrchestratorAddr,
		"HTTP_PORT":                        cfg.HTTPPort,
		"JWT_PUBLIC_KEY o JWT_SIGNING_KEY": cfg.JWTKey,
	} {
		if value == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		slices.Sort(missing)
		return config{}, fmt.Errorf("%w: %s", errMissingEnv, strings.Join(missing, ", "))
	}

	// Orígenes CORS: lista explícita separada por comas, NUNCA `*`. Con comodín el
	// navegador no permite enviar credenciales y, peor, cualquier sitio podría llamar
	// a la API con el token de un usuario que tenga la sesión abierta.
	for _, origin := range strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			cfg.CORSOrigins = append(cfg.CORSOrigins, trimmed)
		}
	}

	cfg.RateLimitPerMinute = defaultRateLimitRPM
	if raw := os.Getenv("RATE_LIMIT_RPM"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed <= 0 {
			// Un valor ilegible NO cae al defecto en silencio: `RATE_LIMIT_RPM: "6OO"`
			// aplicaría 600 y nadie notaría que la configuración pretendida se ignoró.
			return config{}, fmt.Errorf("%w: RATE_LIMIT_RPM debe ser un entero positivo, no %q", errBadEnv, raw)
		}
		cfg.RateLimitPerMinute = parsed
	}

	return cfg, nil
}

func closeQuietly(logger *slog.Logger, what string, closeFn func() error) {
	if err := closeFn(); err != nil {
		logger.Warn("fallo al cerrar un recurso",
			slog.String("recurso", what),
			slog.String("error", err.Error()))
	}
}
