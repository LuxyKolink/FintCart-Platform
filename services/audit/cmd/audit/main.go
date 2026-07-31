// Entrypoint del Servicio de Auditoría (Principio X: «entrypoint delgado»).
//
// Auditoría es un CONSUMIDOR PURO (Principio V): no expone gRPC ni REST, así que
// aquí no hay servidor que arrancar. Lo que hay es un bucle de consumo de RabbitMQ y
// la reconexión que ese bucle necesita para sobrevivir a un reinicio del broker.
//
// Esa reconexión vive en `main.go` a propósito: el ciclo de vida de una conexión es
// exactamente lo que el entrypoint gestiona, mientras que `handler.Consumer` decide
// qué hacer con cada mensaje. Meter el `amqp.Dial` dentro del consumidor lo haría
// imposible de probar sin broker, que es justo lo que su interfaz `Deliveries` evita.
//
// Capa degenerada legítima (plan.md N-01): no hay `server` entre el consumidor y el
// `storer` porque no hay ninguna decisión que tomar — un evento se registra tal cual
// llega, y esa ausencia de lógica es la propiedad que hace confiable un log de
// auditoría.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/jmoiron/sqlx"
	amqp "github.com/rabbitmq/amqp091-go"

	// Driver de PostgreSQL registrado como `pgx`.
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/fintcart/platform/services/audit/internal/handler"
	"github.com/fintcart/platform/services/audit/internal/observability"
	"github.com/fintcart/platform/services/audit/internal/storer"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "audit: fallo fatal: %v\n", err)
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
		return fmt.Errorf("conectar con audit_db: %w", err)
	}
	defer closeQuietly(logger, "conexión con audit_db", db.Close)

	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxIdleConns)
	db.SetConnMaxLifetime(connMaxLifetime)

	consumer := handler.NewConsumer(storer.NewPostgresStorer(db), logger, cfg.Queue)

	// Auditoría no expone gRPC ni REST (Principio V), pero sí necesita sondas: un
	// consumidor que perdió la conexión con la base sigue «arriba» para el orquestador
	// de contenedores y deja de registrar sin que nadie se entere. La readiness es lo
	// único que convierte ese estado en visible.
	go observability.NewProbes(cfg.HealthPort, logger, func(probeCtx context.Context) error {
		if err := db.PingContext(probeCtx); err != nil {
			return fmt.Errorf("audit_db no responde: %w", err)
		}
		return nil
	}).Run(ctx)

	return consumeForever(ctx, logger, consumer, cfg)
}

// consumeForever mantiene el consumo vivo reconectando ante fallos del broker.
//
// Un consumidor de auditoría que se rinde tras la primera desconexión deja de
// registrar sin que nadie se entere: el proceso sigue «arriba», la cola crece y el
// hueco en `audit_log` solo se descubre cuando alguien pide la traza de algo que
// pasó durante la caída. Por eso el fallo de conexión NO termina el proceso.
func consumeForever(ctx context.Context, logger *slog.Logger, consumer *handler.Consumer, cfg config) error {
	backoff := initialBackoff

	for {
		err := consumeOnce(ctx, logger, consumer, cfg)
		if ctx.Err() != nil {
			// El contexto cancelado es el apagado ordenado, no un fallo.
			logger.Info("apagado ordenado completado")
			return nil
		}
		if err != nil {
			logger.Error("consumo interrumpido; se reintentará",
				slog.String("error", err.Error()),
				slog.Duration("retry_in", backoff))
		}

		select {
		case <-ctx.Done():
			logger.Info("apagado ordenado completado")
			return nil
		case <-time.After(backoff):
		}

		// Retroceso exponencial acotado. Sin tope, una caída larga del broker llevaría
		// la espera a horas y el servicio tardaría en recuperarse mucho después de que
		// RabbitMQ hubiera vuelto; sin retroceso, un broker caído recibiría un intento
		// de conexión por milisegundo desde cada réplica.
		backoff = min(backoff*2, maxBackoff)
	}
}

// consumeOnce abre conexión, canal y consumo, y bombea hasta que algo falle.
func consumeOnce(ctx context.Context, logger *slog.Logger, consumer *handler.Consumer, cfg config) error {
	conn, err := amqp.Dial(cfg.AMQPAddr)
	if err != nil {
		return fmt.Errorf("conectar con RabbitMQ: %w", err)
	}
	defer closeQuietly(logger, "conexión con RabbitMQ", conn.Close)

	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("abrir un canal AMQP: %w", err)
	}
	defer closeQuietly(logger, "canal AMQP", ch.Close)

	// Prefetch: cuántos mensajes sin confirmar se aceptan a la vez. Sin límite, el
	// broker empuja toda la cola a este proceso y las demás réplicas se quedan sin
	// nada que hacer — y si el proceso muere, todos esos mensajes vuelven a la cola de
	// golpe.
	if err := ch.Qos(prefetchCount, 0, false); err != nil {
		return fmt.Errorf("configurar el prefetch del canal: %w", err)
	}

	// `autoAck: false` NO es negociable. Con auto-ack el broker da el mensaje por
	// entregado en cuanto sale por el socket, así que un fallo al escribir en
	// `audit_log` perdería el registro sin dejar rastro. La política de ack de las
	// tres salidas la aplica `handler.Consumer`.
	//
	// La cola NO se declara aquí: la topología completa —exchange, colas, bindings y
	// dead-letter— la declara el Orquestador al arrancar (`events.Declare`), en un
	// solo sitio. Declararla también aquí con parámetros que se desviaran un ápice
	// cerraría el canal con un error de equivalencia.
	deliveries, err := ch.Consume(cfg.Queue, consumerTag, false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("consumir de la cola %s: %w", cfg.Queue, err)
	}

	if err := consumer.Run(ctx, deliveries); err != nil {
		return fmt.Errorf("bucle de consumo: %w", err)
	}
	return nil
}

// ── Configuración ───────────────────────────────────────────────────────────

const (
	maxOpenConns    = 10
	maxIdleConns    = 2
	connMaxLifetime = 5 * time.Minute

	// consumerTag identifica a este consumidor en la consola de RabbitMQ. Con un tag
	// vacío el broker genera uno aleatorio y el panel muestra cadenas ilegibles.
	consumerTag = "fintcart-audit"

	prefetchCount  = 32
	initialBackoff = time.Second
	maxBackoff     = 30 * time.Second

	// defaultQueue espeja `events.QueueAudit` del Orquestador. Es una constante y no
	// un import porque cada servicio es un módulo Go independiente: importar el
	// paquete interno de otro servicio sería exactamente el acoplamiento que la
	// separación por módulos evita. El contrato compartido es
	// `contracts/events-catalog.md`.
	defaultQueue = "audit.q"
)

type config struct {
	DBAddr     string
	AMQPAddr   string
	Queue      string
	HealthPort string
	LogLevel   string
}

var errMissingEnv = errors.New("falta una variable de entorno obligatoria")

func loadConfig() (config, error) {
	cfg := config{
		DBAddr:     os.Getenv("DB_ADDR"),
		AMQPAddr:   os.Getenv("AMQP_ADDR"),
		Queue:      os.Getenv("AMQP_QUEUE"),
		HealthPort: os.Getenv("HEALTH_PORT"),
		LogLevel:   os.Getenv("LOG_LEVEL"),
	}
	if cfg.Queue == "" {
		cfg.Queue = defaultQueue
	}

	if cfg.HealthPort == "" {
		cfg.HealthPort = observability.DefaultHealthPort
	}

	missing := make([]string, 0, 2)
	for name, value := range map[string]string{
		"DB_ADDR":   cfg.DBAddr,
		"AMQP_ADDR": cfg.AMQPAddr,
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

func closeQuietly(logger *slog.Logger, what string, closeFn func() error) {
	if err := closeFn(); err != nil {
		logger.Warn("fallo al cerrar un recurso",
			slog.String("recurso", what),
			slog.String("error", err.Error()))
	}
}
