// Entrypoint del Servidor de Autenticación (Principio X: «entrypoint delgado»).
//
// Lee entorno, abre conexiones, ensambla `storer → server → handler` y sirve gRPC.
// Ninguna decisión de autenticación se toma aquí: la política de contraseñas está en
// `internal/server`, el algoritmo de hash en `internal/util` y la firma de los JWT en
// `internal/token`. Este archivo solo los enchufa.
//
// SECRETOS: `JWT_SIGNING_KEY` llega por entorno y NUNCA se versiona ni se registra
// (Principio X). No aparece en ningún `slog` de este archivo, y el único valor
// derivado que se registra es su longitud —a través del error de
// `token.NewJWTMaker`— porque saber que la clave es corta no revela cuál es.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/jmoiron/sqlx"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	// Driver de PostgreSQL registrado como `pgx`. Ver el comentario equivalente en
	// `services/users/cmd/users/main.go`.
	_ "github.com/jackc/pgx/v5/stdlib"

	usersv1 "github.com/fintcart/platform/services/auth-server/gen/fintcart/users/v1"
	"github.com/fintcart/platform/services/auth-server/internal/events"
	"github.com/fintcart/platform/services/auth-server/internal/handler"
	"github.com/fintcart/platform/services/auth-server/internal/observability"
	"github.com/fintcart/platform/services/auth-server/internal/server"
	"github.com/fintcart/platform/services/auth-server/internal/storer"
	"github.com/fintcart/platform/services/auth-server/internal/token"
	"github.com/fintcart/platform/services/auth-server/internal/util"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "auth: fallo fatal: %v\n", err)
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

	db, err := sqlx.ConnectContext(ctx, "pgx", cfg.DBAddr)
	if err != nil {
		return fmt.Errorf("conectar con auth_db: %w", err)
	}
	defer closeQuietly(logger, "conexión con auth_db", db.Close)

	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxIdleConns)
	db.SetConnMaxLifetime(connMaxLifetime)

	// Redis: blacklist de JWT y refresh tokens. Es uno de los DOS usos permitidos en
	// toda la plataforma (Principio IV); el otro es el rate limiting del Gateway.
	//
	// Nada de lo que vive aquí es fuente de verdad: las credenciales están en
	// PostgreSQL, y perder Redis significa —como mucho— que unos tokens revocados
	// vuelvan a ser aceptables hasta que expiren, no que se pierda un dato.
	redisClient := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
	defer closeQuietly(logger, "conexión con Redis", redisClient.Close)

	// A diferencia de gRPC, el cliente de Redis no comprueba nada al construirse. El
	// PING explícito convierte un `REDIS_ADDR` equivocado en un fallo de arranque en
	// lugar de en un 500 en el primer logout.
	pingCtx, cancelPing := context.WithTimeout(ctx, dependencyProbeTimeout)
	defer cancelPing()
	if err := redisClient.Ping(pingCtx).Err(); err != nil {
		return fmt.Errorf("comprobar la conexión con Redis: %w", err)
	}

	// El Servidor de Autenticación es PRODUCTOR de eventos (Principio V):
	// `auth.password_changed`, `auth.security_alert` y `auth.session_revoked`.
	//
	// La TOPOLOGÍA no se declara aquí: la declara el Orquestador. Este proceso solo
	// abre la conexión; los canales los abre el publicador, uno por evento (ver
	// `internal/events/publisher.go`).
	amqpConn, err := amqp.Dial(cfg.AMQPAddr)
	if err != nil {
		return fmt.Errorf("conectar con RabbitMQ: %w", err)
	}
	defer closeQuietly(logger, "conexión con RabbitMQ", amqpConn.Close)

	publisher := events.NewAMQPPublisher(func() (events.Channel, error) {
		ch, err := amqpConn.Channel()
		if err != nil {
			return nil, fmt.Errorf("abrir canal AMQP: %w", err)
		}
		return ch, nil
	}, logger)

	// Los ROLES los posee el Servicio de Usuarios (Principio III): se piden por gRPC
	// y no se leen de su base de datos, aunque estuviera a un `DB_ADDR` de distancia.
	usersConn, err := dialService(cfg.UsersAddr)
	if err != nil {
		return err
	}
	defer closeQuietly(logger, "conexión con Usuarios", usersConn.Close)

	maker, err := token.NewJWTMaker(cfg.JWTSigningKey)
	if err != nil {
		return fmt.Errorf("construir el emisor de JWT: %w", err)
	}

	// ── Ensamblaje: storer → server → handler (Principio IX) ────────────────
	svc := server.New(
		storer.NewPostgresStorer(db),
		storer.NewRedisStore(redisClient),
		util.NewArgon2idHasher(),
		maker,
		server.NewUsersRolesProvider(usersv1.NewUsersServiceClient(usersConn)),
		publisher,
	)
	h := handler.New(svc)

	// El interceptor de métricas va DESPUÉS del de log en la cadena para medir también
	// lo que este último añade.
	interceptors := append(handler.UnaryInterceptors(logger), observability.UnaryServerInterceptor())
	grpcServer := grpc.NewServer(grpc.ChainUnaryInterceptor(interceptors...))
	h.Register(grpcServer)

	// La readiness comprueba las DOS dependencias, y las dos son obligatorias por
	// motivos distintos: sin PostgreSQL no se pueden verificar credenciales, y sin
	// Redis no se puede consultar la blacklist — un Auth que emitiera tokens sin poder
	// saber cuáles están revocados sería peor que uno caído.
	go observability.NewProbes(cfg.HealthPort, logger, func(probeCtx context.Context) error {
		if err := db.PingContext(probeCtx); err != nil {
			return fmt.Errorf("auth_db no responde: %w", err)
		}
		if err := redisClient.Ping(probeCtx).Err(); err != nil {
			return fmt.Errorf("no hay conexión con Redis: %w", err)
		}
		return nil
	}).Run(ctx)

	return serve(ctx, logger, grpcServer, cfg.GRPCPort)
}

// serve arranca el servidor y lo detiene ordenadamente al cancelarse el contexto.
func serve(ctx context.Context, logger *slog.Logger, srv *grpc.Server, port string) error {
	// `ListenConfig.Listen` y no `net.Listen`: el contexto solo se usa para resolver
	// la dirección, no afecta al listener devuelto. Es la variante con contexto que
	// exige el linter, y aquí además evita colgarse en una resolución DNS lenta.
	var lc net.ListenConfig
	lis, err := lc.Listen(ctx, "tcp", ":"+port)
	if err != nil {
		return fmt.Errorf("escuchar en el puerto %s: %w", port, err)
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("servidor de autenticación escuchando", slog.String("port", port))
		errCh <- srv.Serve(lis)
	}()

	select {
	case err := <-errCh:
		if err != nil {
			return fmt.Errorf("servir gRPC: %w", err)
		}
		return nil
	case <-ctx.Done():
		logger.Info("señal de parada recibida; apagado ordenado")
	}

	done := make(chan struct{})
	go func() {
		srv.GracefulStop()
		close(done)
	}()

	select {
	case <-done:
		logger.Info("apagado ordenado completado")
	case <-time.After(shutdownTimeout):
		logger.Warn("el apagado ordenado excedió el plazo; cierre forzado",
			slog.Duration("timeout", shutdownTimeout))
		srv.Stop()
	}
	return nil
}

// ── Configuración ───────────────────────────────────────────────────────────

const (
	maxOpenConns           = 25
	maxIdleConns           = 5
	connMaxLifetime        = 5 * time.Minute
	shutdownTimeout        = 20 * time.Second
	dependencyProbeTimeout = 5 * time.Second
)

type config struct {
	DBAddr     string
	RedisAddr  string
	AMQPAddr   string
	UsersAddr  string
	GRPCPort   string
	HealthPort string
	LogLevel   string

	// JWTSigningKey es un SECRETO. No se registra, no se devuelve en ningún error y
	// no tiene valor por defecto: un servidor de autenticación que arranca con una
	// clave conocida es peor que uno que no arranca.
	JWTSigningKey string
}

var errMissingEnv = errors.New("falta una variable de entorno obligatoria")

func loadConfig() (config, error) {
	cfg := config{
		DBAddr:        os.Getenv("DB_ADDR"),
		RedisAddr:     os.Getenv("REDIS_ADDR"),
		AMQPAddr:      os.Getenv("AMQP_ADDR"),
		UsersAddr:     os.Getenv("USERS_SVC_ADDR"),
		GRPCPort:      os.Getenv("GRPC_PORT"),
		HealthPort:    os.Getenv("HEALTH_PORT"),
		LogLevel:      os.Getenv("LOG_LEVEL"),
		JWTSigningKey: os.Getenv("JWT_SIGNING_KEY"),
	}

	if cfg.HealthPort == "" {
		cfg.HealthPort = observability.DefaultHealthPort
	}

	missing := make([]string, 0, 6)
	for name, value := range map[string]string{
		"DB_ADDR":         cfg.DBAddr,
		"REDIS_ADDR":      cfg.RedisAddr,
		"AMQP_ADDR":       cfg.AMQPAddr,
		"USERS_SVC_ADDR":  cfg.UsersAddr,
		"GRPC_PORT":       cfg.GRPCPort,
		"JWT_SIGNING_KEY": cfg.JWTSigningKey,
	} {
		if value == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		// Se ordena para que el mensaje sea estable entre arranques: el recorrido de un
		// mapa en Go es aleatorio por diseño. Solo aparece el NOMBRE de la variable
		// ausente, nunca su valor — el mensaje incluye `JWT_SIGNING_KEY`.
		slices.Sort(missing)
		return config{}, fmt.Errorf("%w: %s", errMissingEnv, strings.Join(missing, ", "))
	}
	return cfg, nil
}

func dialService(addr string) (*grpc.ClientConn, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("abrir conexión gRPC con %s: %w", addr, err)
	}
	return conn, nil
}

func closeQuietly(logger *slog.Logger, what string, closeFn func() error) {
	if err := closeFn(); err != nil {
		logger.Warn("fallo al cerrar un recurso",
			slog.String("recurso", what),
			slog.String("error", err.Error()))
	}
}
