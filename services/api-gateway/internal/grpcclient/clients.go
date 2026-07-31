// Clientes gRPC salientes del API Gateway.
//
// El Gateway es transporte puro: traduce REST ↔ gRPC y no posee dominio ni base de
// datos (Principio II, plan.md N-01). Este paquete es la mitad saliente de esa
// traducción — la entrante es `internal/handler`.
//
// Las direcciones vienen de variables de entorno y se resuelven por HOSTNAME
// (Principio X regla 3): `users:50051`, no una IP ni una lista de réplicas. El
// descubrimiento y el balanceo los hace la plataforma (DNS de Kubernetes), no este
// código; una lista de direcciones aquí obligaría a redeployar el Gateway cada vez
// que escala otro servicio.
package grpcclient

import (
	"context"
	"errors"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	authv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/auth/v1"
	learningv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/learning/v1"
	orchestratorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/orchestrator/v1"
	simulatorv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/simulator/v1"
	usersv1 "github.com/fintcart/platform/services/api-gateway/gen/fintcart/users/v1"
)

// Config son las direcciones de los servicios internos.
//
// Cinco campos y no seis: Auditoría y Notificación son consumidores puros sin gRPC
// (Principio V, plan.md N-01), así que el Gateway no puede —ni debe— llamarlos.
type Config struct {
	AuthAddr         string
	UsersAddr        string
	LearningAddr     string
	SimulatorAddr    string
	OrchestratorAddr string
}

// Clients agrupa los clientes ya conectados.
//
// Los campos son las interfaces generadas, no structs concretos, de modo que un
// handler se puede probar con dobles sin levantar cinco servidores gRPC.
type Clients struct {
	Auth         authv1.AuthServiceClient
	Users        usersv1.UsersServiceClient
	Learning     learningv1.LearningServiceClient
	Simulator    simulatorv1.SimulatorServiceClient
	Orchestrator orchestratorv1.OrchestratorServiceClient

	conns []*grpc.ClientConn
}

// ErrMissingAddress se devuelve si falta la dirección de un servicio.
//
// Se falla al arrancar y no en la primera petición: una dirección vacía produciría un
// Gateway que acepta tráfico y devuelve 500 en la ruta afectada, y el fallo aparecería
// como un problema del servicio destino en lugar de como un despliegue mal configurado.
var ErrMissingAddress = errors.New("grpcclient: falta la dirección de un servicio")

// Dial abre las cinco conexiones.
//
// `grpc.NewClient` no bloquea: las conexiones se establecen de forma perezosa y se
// reintentan solas. Eso es lo que se quiere en un arranque —el Gateway no debe negarse
// a arrancar porque un servicio de dominio todavía no esté listo—, y la contrapartida
// es que un destino inalcanzable se manifiesta como error en la primera llamada y no
// aquí. Las sondas de `/readyz` (T067) son las que deben reflejarlo.
func Dial(cfg Config) (*Clients, error) {
	addrs := map[string]string{
		"AUTH_SVC_ADDR":         cfg.AuthAddr,
		"USERS_SVC_ADDR":        cfg.UsersAddr,
		"LEARNING_SVC_ADDR":     cfg.LearningAddr,
		"SIMULATOR_SVC_ADDR":    cfg.SimulatorAddr,
		"ORCHESTRATOR_SVC_ADDR": cfg.OrchestratorAddr,
	}
	for name, addr := range addrs {
		if addr == "" {
			return nil, fmt.Errorf("%w: %s", ErrMissingAddress, name)
		}
	}

	c := &Clients{}
	dial := func(addr string) (*grpc.ClientConn, error) {
		// `insecure` es correcto AQUÍ y solo aquí: el tráfico entre servicios va por la
		// red interna del clúster y el cifrado lo aporta la malla de servicio. El borde
		// expuesto —el que atiende `handler`— sí es TLS. Poner TLS también entre pods
		// duplicaría la terminación sin añadir una frontera de confianza nueva.
		conn, err := grpc.NewClient(addr,
			grpc.WithTransportCredentials(insecure.NewCredentials()),
			// Balanceo entre TODAS las réplicas del destino. El valor por defecto de
			// gRPC es `pick_first`: se queda con la primera dirección que resuelve el
			// DNS y no vuelve a mirar, así que con los ≥ 2 réplicas que exige D-12/SC-012
			// una sola recibiría el 100 % del tráfico del Gateway y el autoescalado no
			// serviría de nada.
			grpc.WithDefaultServiceConfig(`{"loadBalancingConfig":[{"round_robin":{}}]}`),
			grpc.WithChainUnaryInterceptor(timeoutInterceptor(defaultCallTimeout)),
		)
		if err != nil {
			return nil, fmt.Errorf("abrir conexión gRPC con %s: %w", addr, err)
		}
		c.conns = append(c.conns, conn)
		return conn, nil
	}

	authConn, err := dial(cfg.AuthAddr)
	if err != nil {
		return nil, errors.Join(err, c.Close())
	}
	usersConn, err := dial(cfg.UsersAddr)
	if err != nil {
		return nil, errors.Join(err, c.Close())
	}
	learningConn, err := dial(cfg.LearningAddr)
	if err != nil {
		return nil, errors.Join(err, c.Close())
	}
	simulatorConn, err := dial(cfg.SimulatorAddr)
	if err != nil {
		return nil, errors.Join(err, c.Close())
	}
	orchestratorConn, err := dial(cfg.OrchestratorAddr)
	if err != nil {
		return nil, errors.Join(err, c.Close())
	}

	c.Auth = authv1.NewAuthServiceClient(authConn)
	c.Users = usersv1.NewUsersServiceClient(usersConn)
	c.Learning = learningv1.NewLearningServiceClient(learningConn)
	c.Simulator = simulatorv1.NewSimulatorServiceClient(simulatorConn)
	c.Orchestrator = orchestratorv1.NewOrchestratorServiceClient(orchestratorConn)
	return c, nil
}

// defaultCallTimeout acota cuánto espera el Gateway a un servicio interno.
//
// Es holgado a propósito: la llamada más lenta del borde es la saga de calificación,
// que encadena Aprendizaje y Usuarios en una sola petición síncrona. Lo que importa no
// es el valor exacto sino que EXISTA — sin plazo, un servicio colgado retiene una
// goroutine y una conexión del Gateway por cada petición entrante, y el borde se agota
// aunque el resto de la plataforma esté sana.
//
// Queda por debajo del `WriteTimeout` del `http.Server` (30 s) para que el cliente
// reciba un 504 explicativo en lugar de una conexión cortada sin respuesta.
const defaultCallTimeout = 20 * time.Second

// timeoutInterceptor pone un plazo a toda llamada que no traiga uno más estricto.
//
// RESPETA el plazo del llamante: si el contexto de la petición HTTP ya vence antes
// —porque el cliente cerró la conexión, por ejemplo—, se deja el más corto. Imponer el
// plazo del Gateway por encima haría que una petición abandonada siguiera consumiendo
// un servicio interno durante veinte segundos más.
func timeoutInterceptor(timeout time.Duration) grpc.UnaryClientInterceptor {
	return func(
		ctx context.Context,
		method string,
		req, reply any,
		cc *grpc.ClientConn,
		invoker grpc.UnaryInvoker,
		opts ...grpc.CallOption,
	) error {
		if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) <= timeout {
			return invoker(ctx, method, req, reply, cc, opts...) //nolint:wrapcheck // interceptor: envolver aquí duplicaría el mensaje que `handler.writeGRPCError` ya traduce por código gRPC.
		}
		ctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		return invoker(ctx, method, req, reply, cc, opts...) //nolint:wrapcheck // ídem.
	}
}

// Close cierra todas las conexiones abiertas.
//
// Une los errores en lugar de devolver el primero: si dos conexiones fallan al
// cerrarse, saber solo de una deja la otra sin diagnosticar.
func (c *Clients) Close() error {
	var errs []error
	for _, conn := range c.conns {
		if err := conn.Close(); err != nil {
			errs = append(errs, fmt.Errorf("cerrar conexión gRPC: %w", err))
		}
	}
	return errors.Join(errs...)
}
