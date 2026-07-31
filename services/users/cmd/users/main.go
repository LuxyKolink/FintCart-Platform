// Entrypoint del Servicio de Usuarios (Principio X: «entrypoint delgado»).
//
// Este archivo hace exactamente cuatro cosas y ninguna más: leer configuración del
// entorno, abrir conexiones, ensamblar `storer → server → handler` y arrancar/parar
// el servidor gRPC. No hay una sola decisión de negocio aquí, y esa es la propiedad
// que hay que preservar en cada cambio: en el momento en que `main.go` sabe qué es un
// perfil o cuándo un puntaje sustituye a otro, esa regla deja de ser comprobable
// desde un test de la capa que la posee.
//
// Configuración 100% por variables de entorno (Principio X regla 2). No hay
// fichero de configuración, ni flags, ni valores por defecto para direcciones:
// un `DB_ADDR` ausente detiene el arranque en lugar de caer en un `localhost`
// implícito que en producción apuntaría a la nada —o, peor, a otra cosa.
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
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	// Driver de PostgreSQL registrado como `pgx` para `database/sql`. Import en
	// blanco: solo se necesita su efecto de registro, y por eso va aquí (donde se
	// abre la conexión) y no en `storer`, que recibe un `*sqlx.DB` ya abierto y no
	// tiene por qué saber qué driver hay debajo.
	_ "github.com/jackc/pgx/v5/stdlib"

	learningv1 "github.com/fintcart/platform/services/users/gen/fintcart/learning/v1"
	simulatorv1 "github.com/fintcart/platform/services/users/gen/fintcart/simulator/v1"
	"github.com/fintcart/platform/services/users/internal/handler"
	"github.com/fintcart/platform/services/users/internal/observability"
	"github.com/fintcart/platform/services/users/internal/server"
	"github.com/fintcart/platform/services/users/internal/storer"
)

func main() {
	if err := run(); err != nil {
		// `os.Exit` salta los `defer`, así que todo el apagado ordenado vive dentro de
		// `run` y aquí solo queda reportar. Escribir el fallo de arranque en stderr y
		// no con el logger estructurado es deliberado: el fallo puede ser justo la
		// construcción del logger.
		fmt.Fprintf(os.Stderr, "users: fallo fatal: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}

	logger := observability.NewLogger(cfg.LogLevel)

	// El contexto se cancela con SIGINT/SIGTERM. SIGTERM es el que manda el
	// orquestador de contenedores al retirar un pod, y atenderlo es lo que separa un
	// despliegue sin cortes de uno que corta las peticiones en vuelo.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := sqlx.ConnectContext(ctx, "pgx", cfg.DBAddr)
	if err != nil {
		return fmt.Errorf("conectar con users_db: %w", err)
	}
	defer closeQuietly(logger, "conexión con users_db", db.Close)

	// Cotas del pool. El valor por defecto de `database/sql` es «ilimitado», que con
	// N réplicas satura `max_connections` de PostgreSQL: el síntoma no es lentitud
	// sino errores de conexión en TODOS los servicios que comparten la instancia.
	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxIdleConns)
	db.SetConnMaxLifetime(connMaxLifetime)

	// Conexión con RabbitMQ. El Servicio de Usuarios es PRODUCTOR de eventos
	// (Principio V): publica `user.registered`, `user.progress.milestone` y
	// `user.activity`. Se abre aquí para fallar al arrancar si el broker no está
	// configurado, en lugar de descubrirlo en la primera publicación.
	//
	// Los productores concretos llegan con las tareas de cada historia; hasta
	// entonces la conexión solo se abre y se cierra.
	amqpConn, err := amqp.Dial(cfg.AMQPAddr)
	if err != nil {
		return fmt.Errorf("conectar con RabbitMQ: %w", err)
	}
	defer closeQuietly(logger, "conexión con RabbitMQ", amqpConn.Close)

	// Clientes gRPC salientes de `GetActivityReport` (plan.md N-02): los contadores
	// de otros servicios se piden por gRPC y NUNCA leyendo su base de datos
	// (Principio III). `grpc.NewClient` no bloquea, así que un servicio destino que
	// todavía no esté listo no impide arrancar.
	learningConn, err := dialService(cfg.LearningAddr)
	if err != nil {
		return err
	}
	defer closeQuietly(logger, "conexión con Aprendizaje", learningConn.Close)

	simulatorConn, err := dialService(cfg.SimulatorAddr)
	if err != nil {
		return err
	}
	defer closeQuietly(logger, "conexión con el Simulador", simulatorConn.Close)

	// ── Ensamblaje: storer → server → handler (Principio IX) ────────────────
	//
	// La dirección es la del grafo de dependencias y se lee de arriba abajo. Cada
	// capa recibe la de abajo por constructor, así que ninguna puede alcanzar a la
	// de arriba ni buscarse la vida por su cuenta.
	store := storer.NewPostgresStorer(db)
	svc := server.New(
		store,
		server.NewLearningAttemptCounter(learningv1.NewLearningServiceClient(learningConn)),
		server.NewSimulatorRunCounter(simulatorv1.NewSimulatorServiceClient(simulatorConn)),
	)
	h := handler.New(svc)

	// El interceptor de métricas va DESPUÉS del de log en la cadena para medir también
	// lo que este último añade: una métrica que excluyera el propio middleware
	// describiría un servicio que no existe.
	interceptors := append(handler.UnaryInterceptors(logger), observability.UnaryServerInterceptor())
	grpcServer := grpc.NewServer(grpc.ChainUnaryInterceptor(interceptors...))
	h.Register(grpcServer)

	// Las sondas viven en su propio puerto y en su propia goroutine: si compartieran
	// el del servicio, retirar tráfico del pod por `/readyz` también dejaría a
	// Kubernetes sin poder consultarlo.
	go observability.NewProbes(cfg.HealthPort, logger, func(probeCtx context.Context) error {
		if err := db.PingContext(probeCtx); err != nil {
			return fmt.Errorf("users_db no responde: %w", err)
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
		logger.Info("servicio de usuarios escuchando", slog.String("port", port))
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

	// `GracefulStop` deja terminar los RPC en vuelo pero no tiene tiempo límite: un
	// stream colgado dejaría el proceso sin apagarse nunca y el orquestador acabaría
	// matándolo con SIGKILL, cortando también todo lo demás. El temporizador
	// convierte ese caso en un cierre forzado y acotado.
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

// Parámetros operativos que no dependen del despliegue.
//
// Son constantes y no variables de entorno a propósito: el criterio del Principio X
// es que sea configurable lo que CAMBIA entre entornos (direcciones, credenciales,
// niveles de log). Un plazo de apagado o el tamaño del pool son decisiones de
// diseño; exponerlas multiplicaría la superficie de configuración sin que nadie las
// vaya a tocar.
const (
	maxOpenConns    = 25
	maxIdleConns    = 5
	connMaxLifetime = 5 * time.Minute
	shutdownTimeout = 20 * time.Second
)

// config es la configuración completa del proceso.
type config struct {
	DBAddr        string
	AMQPAddr      string
	GRPCPort      string
	LearningAddr  string
	SimulatorAddr string
	HealthPort    string
	LogLevel      string
}

// errMissingEnv se devuelve cuando falta una variable obligatoria.
var errMissingEnv = errors.New("falta una variable de entorno obligatoria")

func loadConfig() (config, error) {
	cfg := config{
		DBAddr:        os.Getenv("DB_ADDR"),
		AMQPAddr:      os.Getenv("AMQP_ADDR"),
		GRPCPort:      os.Getenv("GRPC_PORT"),
		LearningAddr:  os.Getenv("LEARNING_SVC_ADDR"),
		SimulatorAddr: os.Getenv("SIMULATOR_SVC_ADDR"),
		HealthPort:    os.Getenv("HEALTH_PORT"),
		LogLevel:      os.Getenv("LOG_LEVEL"),
	}

	// Se comprueban TODAS y se reportan juntas. Fallar en la primera obliga a
	// reiniciar el contenedor una vez por variable ausente, y con siete servicios
	// eso convierte un despliegue mal configurado en una tarde entera.
	if cfg.HealthPort == "" {
		cfg.HealthPort = observability.DefaultHealthPort
	}

	missing := make([]string, 0, 5)
	for name, value := range map[string]string{
		"DB_ADDR":            cfg.DBAddr,
		"AMQP_ADDR":          cfg.AMQPAddr,
		"GRPC_PORT":          cfg.GRPCPort,
		"LEARNING_SVC_ADDR":  cfg.LearningAddr,
		"SIMULATOR_SVC_ADDR": cfg.SimulatorAddr,
	} {
		if value == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		// Se ordena porque el recorrido de un mapa en Go es aleatorio por diseño: sin
		// esto, dos arranques con la misma configuración producirían mensajes distintos
		// y nadie podría agruparlos en un buscador de logs.
		slices.Sort(missing)
		return config{}, fmt.Errorf("%w: %s", errMissingEnv, strings.Join(missing, ", "))
	}
	return cfg, nil
}

// dialService abre una conexión gRPC saliente hacia otro servicio.
//
// `insecure` es correcto aquí: el tráfico va por la red interna del clúster y el
// cifrado lo aporta la malla de servicio. El borde expuesto es el API Gateway, y ahí
// sí hay TLS.
func dialService(addr string) (*grpc.ClientConn, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("abrir conexión gRPC con %s: %w", addr, err)
	}
	return conn, nil
}

// closeQuietly cierra un recurso durante el apagado registrando el fallo.
//
// El error se registra y no se propaga porque en un `defer` de apagado ya no hay
// nada que decidir con él: el proceso termina igual. Ignorarlo del todo, en cambio,
// escondería un cierre que se queda a medias.
func closeQuietly(logger *slog.Logger, what string, closeFn func() error) {
	if err := closeFn(); err != nil {
		logger.Warn("fallo al cerrar un recurso",
			slog.String("recurso", what),
			slog.String("error", err.Error()))
	}
}
