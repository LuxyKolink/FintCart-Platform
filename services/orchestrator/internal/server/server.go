// Capa de aplicación del Orquestador (Principio IX).
//
// «Aplicación» aquí significa MENOS de lo habitual, y a propósito: el Principio VI
// prohíbe lógica de dominio en este servicio. Lo que hay es la traducción de cada
// RPC a un arranque de saga y la consulta de estado. Ninguna regla de negocio —qué
// puntaje aprueba, cuánto vale una cuota, qué campos son obligatorios— vive aquí; si
// alguna aparece, pertenece al servicio dueño de ese dominio.
package server

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/fintcart/platform/services/orchestrator/internal/server/steps"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Errores de dominio de esta capa.
var (
	ErrInvalidArgument = errors.New("server: argumento inválido")
	// ErrNotImplemented marca lo que llega con T060 y las tareas por historia.
	ErrNotImplemented = errors.New("server: no implementado")
)

// Centinelas de persistencia que forman parte del contrato de esta capa, para que
// `handler` no importe `storer`. Alias, para que `errors.Is` recorra la cadena `%w`.
var (
	ErrNotFound = storer.ErrNotFound
	ErrConflict = storer.ErrConflict
)

// Server traduce los RPC de `OrchestratorService` en arranques de saga.
//
// Su única dependencia es el motor. No tiene clientes gRPC propios: los tienen los
// pasos, inyectados en sus definiciones. Esa separación es la que impide que un RPC
// «se salte» la saga y llame directamente a un servicio, que es la forma más fácil
// de perder la garantía de compensación.
type Server struct {
	engine *Engine
}

// New ensambla la capa de aplicación.
func New(engine *Engine) *Server {
	return &Server{engine: engine}
}

// parseSagaID valida el handle antes de que llegue al SQL.
func parseSagaID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%w: saga_id %q no es un UUID", ErrInvalidArgument, raw)
	}
	return id, nil
}

// ── sagas asíncronas: devuelven un handle ───────────────────────────────────

// StartRegistration arranca la saga de registro (D-04).
func (s *Server) StartRegistration(ctx context.Context, email, password, displayName string) (string, error) {
	if email == "" || password == "" {
		return "", fmt.Errorf("%w: email y password son obligatorios", ErrInvalidArgument)
	}
	// Solo se comprueba la PRESENCIA de los campos, no su forma: validar el formato
	// del correo o la fuerza de la contraseña aquí duplicaría reglas que ya viven en
	// Auth, y dos validaciones de la misma regla acaban discrepando (Principio VI).
	//
	// El `user_id` se genera AQUÍ, una sola vez, y viaja en el payload. El contrato
	// lo exige como entrada de `CreateCredential` y de `CreateProfile`, así que
	// alguien tiene que asignarlo antes de que exista ningún participante. Generarlo
	// dentro del primer paso sería el error: un reintento produciría otro
	// identificador y, con él, una segunda credencial que nadie compensaría.
	//
	// La CONTRASEÑA no va en el payload. `saga_state.payload` se escribe en
	// PostgreSQL en cada avance, y meterla ahí la dejaría en claro en la base y en
	// cada copia de seguridad. Viaja como secreto en memoria (ver `steps.State`).
	id, err := s.engine.Start(ctx, storer.SagaRegistro,
		map[string]any{
			"user_id":      uuid.New().String(),
			"email":        email,
			"display_name": displayName,
		},
		map[string]string{steps.SecretPassword: password},
	)
	if err != nil {
		return "", fmt.Errorf("arrancar saga de registro: %w", err)
	}
	return id.String(), nil
}

// StartEmailVerification ejecuta la saga de verificación de correo (FR-002).
//
// Es SÍNCRONA —`Execute` y no `Start`— aunque devuelva un handle, y esa es la
// diferencia que hace utilizable el endpoint: quien valida el token es el primer
// paso, así que arrancarla en segundo plano respondería «aceptado» a un enlace
// caducado y el usuario se quedaría esperando un correo verificado que nunca llega.
// Con la ejecución en línea, un token inválido sale como error del RPC y el borde lo
// convierte en el 400 que declara el contrato.
//
// El token va como SECRETO y no en el payload: `saga_state.payload` se escribe en
// PostgreSQL en cada avance, y ahí dejaría en claro lo que basta para activar la
// cuenta — justo lo que el token existe para impedir.
func (s *Server) StartEmailVerification(ctx context.Context, userID, verificationToken string) (string, error) {
	if userID == "" || verificationToken == "" {
		return "", fmt.Errorf("%w: user_id y verification_token son obligatorios", ErrInvalidArgument)
	}
	sagaID, _, err := s.engine.Execute(ctx, storer.SagaVerificacionEmail,
		map[string]any{"user_id": userID},
		map[string]string{steps.SecretVerificationToken: verificationToken},
	)
	if err != nil {
		// Un `InvalidArgument` del participante significa que rechazó la ENTRADA que
		// este servicio se limitó a reenviar —aquí, el token de verificación—, así que
		// el fallo es del llamante y no de la plataforma. Sin esta traducción el error
		// caería en el `default` del handler y saldría como un 500: el usuario con un
		// enlace caducado vería «error interno» y lo reintentaría indefinidamente en
		// lugar de pedir uno nuevo.
		//
		// Solo se propaga ESE código. Un `NotFound` o un `FailedPrecondition` de un
		// participante hablan de su estado interno, no de lo que pidió el cliente, y
		// convertirlos en respuestas del borde filtraría al exterior el detalle de qué
		// servicio falló.
		if status.Code(err) == codes.InvalidArgument {
			return "", fmt.Errorf("%w: %w", ErrInvalidArgument, err)
		}
		return "", fmt.Errorf("verificar el correo de %s: %w", userID, err)
	}
	// El handle es real, pero para cuando llega la saga ya terminó: consultarlo solo
	// confirmará `completed`. Sirve para rastrear la ejecución, no para esperarla.
	return sagaID.String(), nil
}

// StartAccountAnonymization arranca la saga de anonimización (FR-030, D-08).
func (s *Server) StartAccountAnonymization(ctx context.Context, userID string) (string, error) {
	if userID == "" {
		return "", fmt.Errorf("%w: user_id es obligatorio", ErrInvalidArgument)
	}
	id, err := s.engine.Start(ctx, storer.SagaAnonimizacion, map[string]any{"user_id": userID}, nil)
	if err != nil {
		return "", fmt.Errorf("arrancar saga de anonimización: %w", err)
	}
	return id.String(), nil
}

// ── sagas síncronas: devuelven el resultado ────────────────────────────────

// QuizGrading es el resultado de la saga de calificación.
//
// `Score` es una `string` decimal canónica y NO un número: el Orquestador la recibe
// de Aprendizaje y la reenvía sin tocarla (Principio VIII / D-10). Convertirla a
// `float64` aquí para «pasarla» perdería centésimas de una calificación en un
// servicio que no tiene ninguna razón para interpretarla.
type QuizGrading struct {
	AttemptID   string
	AttemptNo   int32
	Score       string
	Passed      bool
	PointsAfter int32
}

// StartQuizGrading ejecuta la saga de calificación y espera su resultado (D-07).
//
// Es síncrona porque el usuario está esperando su nota: devolver un handle y obligar
// al Gateway a sondear convertiría una interacción inmediata en un bucle de espera.
func (s *Server) StartQuizGrading(
	ctx context.Context,
	userID, quizID string,
	answers map[string]string,
) (QuizGrading, error) {
	if userID == "" || quizID == "" {
		return QuizGrading{}, fmt.Errorf("%w: user_id y quiz_id son obligatorios", ErrInvalidArgument)
	}
	// Un mapa de respuestas VACÍO no se rechaza: quién puede entregar en blanco y qué
	// nota merece son reglas de Aprendizaje, y comprobarlas aquí las duplicaría
	// (Principio VI). Lo que sí se garantiza es que la clave existe en el payload,
	// para que el paso no falle con «falta answers» cuando el usuario simplemente no
	// respondió nada.
	if answers == nil {
		answers = map[string]string{}
	}

	_, final, err := s.engine.Execute(ctx, storer.SagaCalificacion, map[string]any{
		"user_id": userID,
		"quiz_id": quizID,
		"answers": answers,
	}, nil)
	if err != nil {
		return QuizGrading{}, fmt.Errorf("ejecutar saga de calificación: %w", err)
	}
	return quizGradingFromPayload(final)
}

// Simulation es el resultado de una simulación mediada.
//
// `Result` es un mapa de strings decimales, igual que las entradas: los montos no se
// convierten en ningún punto de este servicio (Principio VIII).
// El instante de cálculo NO viaja aquí aunque el Simulador lo devuelva y la saga lo
// deje en su payload: `orchestrator.v1.SimulationResult` no tiene ese campo, así que
// añadirlo a este struct sería estado muerto. Queda anotado como hueco menor de
// contrato — la marca temporal sí aparece en el historial (`ListHistory.created_at`).
type Simulation struct {
	SimulationID string
	Result       map[string]string
}

// StartSimulation ejecuta la simulación mediada y espera su resultado (D-03).
//
// Es SÍNCRONA porque el usuario está mirando la pantalla: devolver un handle para que
// el Gateway sondee convertiría un cálculo instantáneo en un bucle de espera.
func (s *Server) StartSimulation(
	ctx context.Context,
	userID string,
	calcType int32,
	currency string,
	inputs map[string]string,
) (Simulation, error) {
	if userID == "" {
		return Simulation{}, fmt.Errorf("%w: user_id es obligatorio", ErrInvalidArgument)
	}
	// `calcType` viaja como el entero del enum del contrato del Simulador y NO se
	// comprueba aquí: el dueño del enum es el Simulador, y una segunda lista de
	// valores válidos en este servicio acabaría discrepando de la suya (Principio VI).
	// Lo mismo con los `inputs`: qué parámetros necesita cada calculadora, y con qué
	// escala, lo decide quien calcula.
	//
	// Un mapa de entradas VACÍO tampoco se rechaza, por la misma razón: hay
	// calculadoras cuyos parámetros son todos opcionales, y saber cuáles sería
	// conocer su dominio.
	if inputs == nil {
		inputs = map[string]string{}
	}

	_, final, err := s.engine.Execute(ctx, storer.SagaSimulacion, map[string]any{
		"user_id":   userID,
		"calc_type": calcType,
		"currency":  currency,
		"inputs":    inputs,
	}, nil)
	if err != nil {
		// Igual que en la verificación de correo: un `InvalidArgument` del Simulador
		// significa que rechazó la ENTRADA que este servicio se limitó a reenviar —un
		// monto no canónico, un plazo irrazonable—, así que es un error del llamante y
		// no de la plataforma. Sin esta traducción saldría como 500 y el usuario
		// reintentaría indefinidamente una petición que nunca va a funcionar.
		if status.Code(err) == codes.InvalidArgument {
			return Simulation{}, fmt.Errorf("%w: %w", ErrInvalidArgument, err)
		}
		return Simulation{}, fmt.Errorf("ejecutar saga de simulación: %w", err)
	}
	return simulationFromPayload(final)
}

// simulationFromPayload extrae el resultado del payload final de la saga.
//
// Comprueba lo que lee en vez de asumirlo: el payload es un `map[string]any` sin
// tipo, y un `final["result"].(map[string]string)` haría pánico —no error— si el paso
// anterior no lo hubiera dejado.
func simulationFromPayload(final map[string]any) (Simulation, error) {
	id, err := payloadString(final, "simulation_id")
	if err != nil {
		return Simulation{}, err
	}
	result, ok := final["result"].(map[string]string)
	if !ok {
		return Simulation{}, fmt.Errorf("%w: la saga no dejó el resultado de la simulación",
			ErrIncompletePayload)
	}
	return Simulation{SimulationID: id, Result: result}, nil
}

// StartActivity arranca la saga de actividad (FR-023, plan.md N-03).
//
// HUECO DE CONTRATO: `orchestrator.proto` no tiene un RPC que llegue aquí, así que
// hoy este método solo es alcanzable en proceso. Se implementa igualmente porque la
// definición de la saga existe y el CHECK del esquema admite el tipo `actividad`;
// dejarlo sin punto de entrada en la capa de aplicación habría escondido el hueco en
// lugar de señalarlo. Añadir el RPC obliga a decidir también su ruta REST, que
// pertenece a las tareas del borde.
//
// Es ASÍNCRONA: nadie espera el resultado de una notificación, al contrario que una
// calificación.
func (s *Server) StartActivity(ctx context.Context, userID, notifType, payloadJSON string) (string, error) {
	if userID == "" || notifType == "" {
		return "", fmt.Errorf("%w: user_id y notification_type son obligatorios", ErrInvalidArgument)
	}
	// El tipo NO se valida contra la lista de tipos admitidos: la lista la posee
	// Usuarios —está en el CHECK de su tabla y en su capa de aplicación— y repetirla
	// aquí crearía dos sitios que pueden discrepar (Principio VI).
	id, err := s.engine.Start(ctx, storer.SagaActividad, map[string]any{
		"user_id":              userID,
		"notification_type":    notifType,
		"notification_payload": payloadJSON,
	}, nil)
	if err != nil {
		return "", fmt.Errorf("arrancar saga de actividad: %w", err)
	}
	return id.String(), nil
}

// quizGradingFromPayload extrae el resultado del payload final de la saga.
//
// Es un mapeo explícito y no un `for` sobre el mapa porque el payload es un
// documento opaco: si un paso deja de escribir `points_after`, esto tiene que fallar
// con el nombre del campo que falta, no devolver un cero que el usuario leería como
// «perdiste todos tus puntos».
func quizGradingFromPayload(payload map[string]any) (QuizGrading, error) {
	attemptID, err := payloadString(payload, "attempt_id")
	if err != nil {
		return QuizGrading{}, err
	}
	// El `score` se copia como CADENA, sin pasar por ningún tipo numérico: es una
	// calificación decimal y convertirla aquí perdería centésimas (Principio VIII).
	score, err := payloadString(payload, "score")
	if err != nil {
		return QuizGrading{}, err
	}
	attemptNo, err := payloadInt32(payload, "attempt_no")
	if err != nil {
		return QuizGrading{}, err
	}
	pointsAfter, err := payloadInt32(payload, "points_after")
	if err != nil {
		return QuizGrading{}, err
	}
	passed, _ := payload["passed"].(bool)

	return QuizGrading{
		AttemptID:   attemptID,
		AttemptNo:   attemptNo,
		Score:       score,
		Passed:      passed,
		PointsAfter: pointsAfter,
	}, nil
}

// ErrIncompletePayload marca una saga que terminó sin dejar lo que su resultado
// necesita. Es un error propio para que el fallo se distinga de un argumento
// inválido del cliente: aquí el que se equivocó es un paso, no quien llamó.
var ErrIncompletePayload = errors.New("server: payload de saga incompleto")

func payloadString(payload map[string]any, key string) (string, error) {
	value, ok := payload[key].(string)
	if !ok || value == "" {
		return "", fmt.Errorf("%w: falta %q", ErrIncompletePayload, key)
	}
	return value, nil
}

// payloadInt32 lee un entero del payload de la saga.
//
// Acepta las dos representaciones posibles: `int32`, que es lo que el paso deja en
// memoria, y `float64`, que es lo que produce `encoding/json` al releer el payload
// tras una reanudación. Sin el segundo caso, el resultado sería correcto siempre…
// salvo justo después de un reinicio.
//
// El `nolint` es correcto y no un atajo: la prohibición de `float64` del Principio
// VIII es sobre DINERO, y esto son un número de intento y unos puntos —enteros por
// definición—. El único valor monetario de esta saga es el `score`, que viaja como
// cadena y no pasa por aquí.
//
//nolint:forbidigo // Enteros de JSON, no importes: ver arriba.
func payloadInt32(payload map[string]any, key string) (int32, error) {
	switch typed := payload[key].(type) {
	case int32:
		return typed, nil
	case float64:
		return int32(typed), nil
	default:
		return 0, fmt.Errorf("%w: falta %q o no es un entero (%T)", ErrIncompletePayload, key, payload[key])
	}
}

// ── consulta de estado ─────────────────────────────────────────────────────

// GetSagaStatus consulta el estado de una saga por su handle.
func (s *Server) GetSagaStatus(ctx context.Context, sagaID string) (SagaStatus, error) {
	id, err := parseSagaID(sagaID)
	if err != nil {
		return SagaStatus{}, err
	}
	return s.engine.Status(ctx, id)
}
