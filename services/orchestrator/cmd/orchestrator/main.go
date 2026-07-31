// Entrypoint del Orquestador de Sagas (Principio X: «entrypoint delgado»).
//
// Ensambla tres piezas y las arranca:
//
//  1. El motor de sagas (`storer → server → handler`) servido por gRPC.
//  2. La topología de RabbitMQ (exchange, colas y bindings), declarada de forma
//     idempotente en cada arranque.
//  3. El publicador del outbox transaccional (research D-07), que corre en paralelo
//     al servidor gRPC durante toda la vida del proceso.
//
// La tercera es la que obliga a que este archivo coordine dos goroutines de larga
// duración en lugar de una. Las dos comparten el mismo contexto de señal, así que un
// SIGTERM las para a la vez: si el relay siguiera vivo tras parar el servidor,
// publicaría eventos de sagas que ya nadie puede avanzar.
//
// **Principio VI**: aquí no hay ni una regla de negocio. El Orquestador coordina; las
// decisiones las toman los servicios participantes a través de sus RPC.
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
	"sync"
	"syscall"
	"time"

	"github.com/jmoiron/sqlx"
	amqp "github.com/rabbitmq/amqp091-go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	// Driver de PostgreSQL registrado como `pgx`.
	_ "github.com/jackc/pgx/v5/stdlib"

	authv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/auth/v1"
	learningv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/learning/v1"
	simulatorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/simulator/v1"
	usersv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/users/v1"
	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/handler"
	"github.com/fintcart/platform/services/orchestrator/internal/observability"
	"github.com/fintcart/platform/services/orchestrator/internal/outbox"
	"github.com/fintcart/platform/services/orchestrator/internal/server"
	"github.com/fintcart/platform/services/orchestrator/internal/server/steps"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "orchestrator: fallo fatal: %v\n", err)
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
		return fmt.Errorf("conectar con orchestrator_db: %w", err)
	}
	defer closeQuietly(logger, "conexión con orchestrator_db", db.Close)

	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxIdleConns)
	db.SetConnMaxLifetime(connMaxLifetime)

	amqpConn, err := amqp.Dial(cfg.AMQPAddr)
	if err != nil {
		return fmt.Errorf("conectar con RabbitMQ: %w", err)
	}
	defer closeQuietly(logger, "conexión con RabbitMQ", amqpConn.Close)

	ch, err := amqpConn.Channel()
	if err != nil {
		return fmt.Errorf("abrir un canal AMQP: %w", err)
	}
	defer closeQuietly(logger, "canal AMQP", ch.Close)

	// La topología la declara el Orquestador porque es el único PRODUCTOR de eventos
	// que existe en el plano de sagas: si la declararan los consumidores, el orden de
	// arranque decidiría si un evento publicado antes de que existiera su cola se
	// pierde. Declararla aquí, antes de servir, elimina esa carrera.
	//
	// Es idempotente, así que las ≥ 2 réplicas (D-12) la declaran todas sin
	// conflicto.
	if err := events.Declare(ch); err != nil {
		return fmt.Errorf("declarar la topología de eventos: %w", err)
	}

	// Clientes gRPC de los servicios participantes. No hay cliente de Auditoría ni de
	// Notificación: son consumidores puros y se les llega por evento (Principio V,
	// plan.md N-01).
	conns, participants, err := dialParticipants(cfg)
	if err != nil {
		return err
	}
	for _, conn := range conns {
		defer closeQuietly(logger, "conexión gRPC con un participante", conn.Close)
	}

	// ── Ensamblaje: storer → server → handler (Principio IX) ────────────────
	store := storer.NewPostgresStorer(db)
	engine := server.NewEngine(store, logger,
		steps.RegistrationDefinition(participants),
		steps.EmailVerificationDefinition(participants),
		steps.GradingDefinition(participants),
		steps.SimulationDefinition(participants),
		steps.AnonymizationDefinition(participants),
		steps.ActivityDefinition(participants),
	)
	// Este defer se registra DESPUÉS de los que cierran la base y las conexiones
	// gRPC, así que se ejecuta ANTES que ellos (los defer corren en orden inverso).
	// El orden es la única razón por la que está aquí y no junto al ensamblaje: una
	// saga en vuelo necesita el pool y los participantes hasta su último paso.
	defer func() {
		if !engine.Wait(shutdownTimeout) {
			logger.Warn("el apagado deja sagas en vuelo; se reanudarán en el próximo arranque",
				slog.Duration("timeout", shutdownTimeout))
		}
	}()

	h := handler.New(server.New(engine))

	// El interceptor de métricas va DESPUÉS del de log en la cadena para medir también
	// lo que este último añade.
	interceptors := append(handler.UnaryInterceptors(logger), observability.UnaryServerInterceptor())
	grpcServer := grpc.NewServer(grpc.ChainUnaryInterceptor(interceptors...))
	h.Register(grpcServer)

	// La readiness comprueba la base, que es de lo que depende poder ARRANCAR una
	// saga. No comprueba los participantes: que Aprendizaje esté caído no debe sacar
	// de servicio al Orquestador, porque las sagas que no dependan de él siguen
	// pudiendo avanzar y las que sí ya tienen su propia compensación.
	go observability.NewProbes(cfg.HealthPort, logger, func(probeCtx context.Context) error {
		if err := db.PingContext(probeCtx); err != nil {
			return fmt.Errorf("orchestrator_db no responde: %w", err)
		}
		return nil
	}).Run(ctx)

	relay := outbox.NewRelay(store, events.NewAMQPPublisher(ch), logger, outbox.Config{
		Exchange:  events.ExchangeName,
		BatchSize: outboxBatchSize,
		Interval:  outboxInterval,
	})

	return serve(ctx, logger, grpcServer, relay, engine, cfg.GRPCPort)
}

// serve corre el servidor gRPC, el publicador del outbox y el barrido de reanudación
// hasta la señal de parada.
func serve(
	ctx context.Context,
	logger *slog.Logger,
	srv *grpc.Server,
	relay *outbox.Relay,
	engine *server.Engine,
	port string,
) error {
	// `ListenConfig.Listen` y no `net.Listen`: el contexto solo se usa para resolver
	// la dirección, no afecta al listener devuelto. Es la variante con contexto que
	// exige el linter, y aquí además evita colgarse en una resolución DNS lenta.
	var lc net.ListenConfig
	lis, err := lc.Listen(ctx, "tcp", ":"+port)
	if err != nil {
		return fmt.Errorf("escuchar en el puerto %s: %w", port, err)
	}

	// El contexto de los dos trabajos se cancela también si uno falla, para que el
	// proceso no se quede a medias: un Orquestador que sirve RPC pero no publica
	// eventos acepta sagas que nadie completará, y es peor que uno caído —el segundo
	// se reinicia solo y el primero parece sano.
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	var wg sync.WaitGroup
	errCh := make(chan error, 2)

	// El rescate de sagas a medias es PERIÓDICO y no un barrido único al arrancar.
	// Con un barrido único, una saga abandonada por una réplica que muere seguiría
	// parada hasta que ESA réplica volviera; con el barrido periódico la recoge
	// cualquiera de las que están vivas, que es lo que hace útil tener ≥ 2 (D-12).
	//
	// No entra en `errCh`: que el rescate falle una vez no justifica tumbar un
	// proceso que sigue atendiendo sagas nuevas correctamente.
	wg.Add(1)
	go func() {
		defer wg.Done()
		resumeLoop(runCtx, logger, engine)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		defer cancel()
		logger.Info("orquestador escuchando", slog.String("port", port))
		if err := srv.Serve(lis); err != nil {
			errCh <- fmt.Errorf("servir gRPC: %w", err)
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		defer cancel()
		logger.Info("publicador del outbox arrancado", slog.Duration("interval", outboxInterval))
		if err := relay.Run(runCtx); err != nil {
			errCh <- fmt.Errorf("publicador del outbox: %w", err)
		}
	}()

	<-runCtx.Done()
	logger.Info("parada solicitada; apagado ordenado")

	done := make(chan struct{})
	go func() {
		srv.GracefulStop()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(shutdownTimeout):
		logger.Warn("el apagado ordenado excedió el plazo; cierre forzado",
			slog.Duration("timeout", shutdownTimeout))
		srv.Stop()
	}

	wg.Wait()
	close(errCh)

	// Se unen todos los errores en lugar de devolver el primero: si el servidor y el
	// relay fallan a la vez, quedarse con uno esconde la mitad del diagnóstico.
	var errs []error
	for err := range errCh {
		errs = append(errs, err)
	}
	if joined := errors.Join(errs...); joined != nil {
		return joined
	}
	logger.Info("apagado ordenado completado")
	return nil
}

// resumeLoop reclama periódicamente las sagas que quedaron a medias.
func resumeLoop(ctx context.Context, logger *slog.Logger, engine *server.Engine) {
	sweep := func() {
		if err := engine.Resume(ctx, resumeBatchSize); err != nil {
			logger.ErrorContext(ctx, "barrido de reanudación fallido",
				slog.String("error", err.Error()))
		}
	}

	// Un primer barrido inmediato: tras un reinicio, lo que quedó a medias lleva ya
	// esperando todo lo que duró la caída, y hacerle esperar un ciclo más solo alarga
	// el tiempo que un usuario pasa con el registro sin terminar.
	sweep()

	ticker := time.NewTicker(resumeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			logger.Info("barrido de reanudación detenido")
			return
		case <-ticker.C:
			sweep()
		}
	}
}

// dialParticipants abre las cuatro conexiones salientes.
//
// Devuelve también las conexiones crudas para poder cerrarlas: `steps.Clients` solo
// guarda las interfaces generadas, que no exponen `Close`.
func dialParticipants(cfg config) ([]*grpc.ClientConn, steps.Clients, error) {
	addrs := []string{cfg.UsersAddr, cfg.AuthAddr, cfg.LearningAddr, cfg.SimulatorAddr}
	conns := make([]*grpc.ClientConn, 0, len(addrs))
	for _, addr := range addrs {
		conn, err := dialService(addr)
		if err != nil {
			return nil, steps.Clients{}, errors.Join(err, closeAll(conns))
		}
		conns = append(conns, conn)
	}
	return conns, steps.Clients{
		Users:     usersv1.NewUsersServiceClient(conns[0]),
		Auth:      authv1.NewAuthServiceClient(conns[1]),
		Learning:  learningv1.NewLearningServiceClient(conns[2]),
		Simulator: simulatorv1.NewSimulatorServiceClient(conns[3]),
	}, nil
}

// closeAll cierra las conexiones ya abiertas cuando una posterior falla.
func closeAll(conns []*grpc.ClientConn) error {
	var errs []error
	for _, conn := range conns {
		if err := conn.Close(); err != nil {
			errs = append(errs, fmt.Errorf("cerrar conexión gRPC: %w", err))
		}
	}
	return errors.Join(errs...)
}

// ── Configuración ───────────────────────────────────────────────────────────

const (
	maxOpenConns    = 25
	maxIdleConns    = 5
	connMaxLifetime = 5 * time.Minute
	shutdownTimeout = 20 * time.Second

	// outboxBatchSize acota cuántos eventos se traen por barrido: sin cota, el
	// backlog acumulado tras una caída del broker se cargaría entero en memoria.
	outboxBatchSize = 100
	// outboxInterval es la espera entre barridos. Es el retardo máximo entre
	// confirmar una saga y publicar su evento, así que subirlo hace que los correos
	// tarden más en salir; bajarlo multiplica las consultas al outbox vacío.
	outboxInterval = 2 * time.Second

	// resumeBatchSize acota cuántas sagas se rescatan por barrido. Tras una caída
	// larga puede haber miles: traerlas de golpe convertiría la recuperación en una
	// segunda caída, esta vez provocada por el propio rescate.
	resumeBatchSize = 50
	// resumeInterval es la espera entre barridos de rescate. Debe ser mayor que el
	// margen de antigüedad que exige `storer.ListResumable` para reclamar una saga;
	// si fuera menor, cada barrido encontraría vacío lo que el anterior acaba de
	// reclamar y el rescate no avanzaría más rápido, solo consultaría más.
	resumeInterval = 2 * time.Minute
)

type config struct {
	DBAddr        string
	AMQPAddr      string
	AuthAddr      string
	UsersAddr     string
	LearningAddr  string
	SimulatorAddr string
	GRPCPort      string
	HealthPort    string
	LogLevel      string
}

var errMissingEnv = errors.New("falta una variable de entorno obligatoria")

func loadConfig() (config, error) {
	cfg := config{
		DBAddr:        os.Getenv("DB_ADDR"),
		AMQPAddr:      os.Getenv("AMQP_ADDR"),
		AuthAddr:      os.Getenv("AUTH_SVC_ADDR"),
		UsersAddr:     os.Getenv("USERS_SVC_ADDR"),
		LearningAddr:  os.Getenv("LEARNING_SVC_ADDR"),
		SimulatorAddr: os.Getenv("SIMULATOR_SVC_ADDR"),
		GRPCPort:      os.Getenv("GRPC_PORT"),
		HealthPort:    os.Getenv("HEALTH_PORT"),
		LogLevel:      os.Getenv("LOG_LEVEL"),
	}

	if cfg.HealthPort == "" {
		cfg.HealthPort = observability.DefaultHealthPort
	}

	missing := make([]string, 0, 7)
	for name, value := range map[string]string{
		"DB_ADDR":            cfg.DBAddr,
		"AMQP_ADDR":          cfg.AMQPAddr,
		"AUTH_SVC_ADDR":      cfg.AuthAddr,
		"USERS_SVC_ADDR":     cfg.UsersAddr,
		"LEARNING_SVC_ADDR":  cfg.LearningAddr,
		"SIMULATOR_SVC_ADDR": cfg.SimulatorAddr,
		"GRPC_PORT":          cfg.GRPCPort,
	} {
		if value == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
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
