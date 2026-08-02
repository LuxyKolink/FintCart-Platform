// Pasos de saga: el vocabulario que comparten el motor y las definiciones.
//
// Este paquete existe para romper un ciclo de importación. El motor
// (`internal/server/saga.go`) ejecuta pasos, y cada definición de saga declara los
// suyos; si los tipos vivieran en `server`, los archivos de `steps/` tendrían que
// importarlo y `server` tendría que importar `steps/`. Con los tipos aquí, la
// dependencia va en un solo sentido: `server` → `steps`.
//
// **Principio VI**: nada de esto contiene lógica de dominio. Un paso invoca un RPC
// y, si hace falta, sabe cómo deshacerlo. No calcula puntajes, no valida reglas de
// negocio y no interpreta el resultado más allá de decidir si el paso tuvo éxito.
// Ese es el límite entre orquestar y decidir.
//
// Los pasos usan directamente los clientes gRPC generados en lugar de puertos
// estrechos, y es una excepción DELIBERADA al patrón del resto de la plataforma: el
// Orquestador no tiene dominio propio, así que un puerto por RPC sería una capa de
// indirección que no traduce nada. Los clientes generados ya son interfaces, de
// modo que los dobles de prueba siguen siendo posibles (T071, T072).
package steps

import (
	"context"
	"errors"
	"fmt"
	"math"

	authv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/auth/v1"
	learningv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/learning/v1"
	simulatorv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/simulator/v1"
	usersv1 "github.com/fintcart/platform/services/orchestrator/gen/fintcart/users/v1"
)

// Errores de los pasos.
var (
	// ErrNotImplemented marca los pasos del esqueleto (T026). Las implementaciones
	// llegan con T060 y las tareas por historia.
	ErrNotImplemented = errors.New("steps: no implementado")

	// ErrPayloadInvalid marca un payload de saga del que falta un dato que un paso
	// anterior debía haber dejado.
	ErrPayloadInvalid = errors.New("steps: payload de saga inválido")

	// ErrSecretUnavailable marca un secreto que no está disponible, típicamente
	// porque la saga se reanudó tras un reinicio (ver [State.Secrets]).
	ErrSecretUnavailable = errors.New("steps: secreto de saga no disponible")
)

// Claves del payload de saga.
//
// Son constantes y no literales dispersos porque el payload es un `map[string]any`
// sin tipo: un `"user_id"` mal escrito en el paso que ESCRIBE y bien escrito en el
// que LEE no da error de compilación — da una saga que compensa en producción con un
// «falta user_id» que no dice quién debía haberlo puesto.
//
// No son exportadas: quien arranca una saga usa los ayudantes de `server`, y un
// productor externo que compusiera el mapa a mano sería justo la forma de que las
// claves se desincronizaran.
const (
	payloadUserID      = "user_id"
	payloadEmail       = "email"
	payloadDisplayName = "display_name"
	payloadQuizID      = "quiz_id"
	payloadAnswers     = "answers"
	payloadAttemptID   = "attempt_id"
	payloadAttemptNo   = "attempt_no"
	payloadScore       = "score"
	payloadPassed      = "passed"
	payloadPointsAfter = "points_after"
	payloadNotifType   = "notification_type"
	payloadNotifBody   = "notification_payload"

	payloadCalcType     = "calc_type"
	payloadCurrency     = "currency"
	payloadInputs       = "inputs"
	payloadSimulationID = "simulation_id"
	payloadResult       = "result"
	payloadComputedAt   = "computed_at"
)

// SecretPassword es la clave de la contraseña en [State.Secrets].
//
// Es exportada, al contrario que las claves del payload, porque quien arranca la
// saga de registro tiene que rellenarla desde `server` — y ese es exactamente el
// único sitio del proceso por el que una contraseña en claro puede pasar.
const SecretPassword = "password"

// SecretVerificationToken es la clave del token de verificación de correo en
// [State.Secrets].
//
// Va como SECRETO y no en el payload por la misma razón que la contraseña:
// `saga_state.payload` se escribe en PostgreSQL en cada avance, y quien leyera esa
// tabla podría activar la cuenta pendiente sin haber tocado el buzón — que es
// exactamente lo que el token existe para impedir.
const SecretVerificationToken = "verification_token"

// Claves del payload del evento `user.registered`
// (`contracts/events/events-catalog.md`).
//
// El correo de verificación es el ÚNICO del sistema dirigido a alguien que todavía
// no tiene sesión, así que el evento tiene que llevar todo lo que hace falta para
// componerlo: a quién escribir y qué enlace ponerle.
const (
	eventKeyUserID            = "user_id"
	eventKeyEmail             = "email"
	eventKeyDisplayName       = "display_name"
	eventKeyVerificationToken = "verification_token"
	eventKeyVerificationExp   = "verification_expires_at"
)

// Clients agrupa los clientes gRPC de los servicios participantes.
//
// `cmd/orchestrator/main.go` los construye con las direcciones de entorno y los
// pasa aquí (Principio X regla 3: descubrimiento por hostname). No incluye
// Auditoría ni Notificación: son consumidores puros y no exponen gRPC
// (Principio V, plan.md N-01), así que se les llega por evento, nunca por llamada.
type Clients struct {
	Users     usersv1.UsersServiceClient
	Auth      authv1.AuthServiceClient
	Learning  learningv1.LearningServiceClient
	Simulator simulatorv1.SimulatorServiceClient
}

// State es el estado vivo de una saga en ejecución.
//
// `Payload` es el documento opaco que viaja entre pasos: cada paso escribe en él lo
// que el siguiente necesita (el `user_id` recién creado, el `attempt_id` de la
// calificación). Se persiste en `saga_state.payload` en cada avance, y por eso una
// saga puede reanudarse tras un reinicio — sin persistirlo, la reanudación no
// tendría con qué continuar.
//
// Es `map[string]any` y no un struct por saga porque el motor no debe conocer la
// forma del payload de cada flujo; en el momento en que lo conociera, tendría
// lógica de dominio (Principio VI).
type State struct {
	SagaID  string
	Type    string
	Step    int32
	Payload map[string]any

	// Secrets son los datos que un paso necesita y que NO pueden persistirse.
	//
	// Existe por la contraseña del registro. `Payload` se escribe en
	// `saga_state.payload` en cada avance, así que meter ahí la contraseña en claro
	// la dejaría en PostgreSQL —y en cada copia de seguridad— hasta que la fila se
	// limpiara. La constitución lo prohíbe, y ningún cifrado en la columna lo
	// arreglaría: la clave estaría en el mismo despliegue.
	//
	// La consecuencia es deliberada y hay que conocerla: tras un reinicio, una saga
	// reanudada NO tiene sus secretos. Un paso que los necesite falla y la saga
	// compensa, en lugar de continuar con un valor vacío. Para el registro eso
	// significa que una caída entre la creación de la saga y la de la credencial
	// obliga al usuario a repetir el alta — que es exactamente lo que debe pasar, y
	// mucho mejor que la alternativa.
	Secrets map[string]string
}

// Secret devuelve un secreto de la saga o falla si no está.
//
// El error explica que el valor se perdió en una reanudación en lugar de decir
// «campo vacío»: sin esa distinción, el síntoma sería una credencial creada con una
// contraseña en blanco y nadie sabría por qué.
func (s *State) Secret(key string) (string, error) {
	value, ok := s.Secrets[key]
	if !ok || value == "" {
		return "", fmt.Errorf("%w: %q (los secretos no sobreviven a una reanudación)",
			ErrSecretUnavailable, key)
	}
	return value, nil
}

// String extrae del payload un valor de texto puesto por un paso anterior.
//
// El payload viaja como JSONB, así que al releerlo tras una reanudación todo llega
// como `any`. Sin esta comprobación, un `st.Payload["user_id"].(string)` haría
// pánico en la goroutine de la saga —no un error— si el valor faltara.
func (s *State) String(key string) (string, error) {
	raw, ok := s.Payload[key]
	if !ok {
		return "", fmt.Errorf("%w: falta %q en el payload de la saga", ErrPayloadInvalid, key)
	}
	value, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("%w: %q es %T y se esperaba una cadena", ErrPayloadInvalid, key, raw)
	}
	if value == "" {
		return "", fmt.Errorf("%w: %q está vacío", ErrPayloadInvalid, key)
	}
	return value, nil
}

// Int32 extrae del payload un entero puesto por quien arrancó la saga.
//
// Acepta las DOS formas por la misma razón que [State.StringMap]: `int32` es lo que
// queda en memoria y `float64` es lo que devuelve `encoding/json` al releer el
// payload tras una reanudación —JSON no tiene enteros—. Tratar solo la primera haría
// que la saga funcionara siempre salvo justo después de un reinicio.
//
// El `float64` de aquí NO es dinero y no infringe el Principio VIII: es el enum de un
// tipo de cálculo, un identificador. Se comprueba además que no traiga parte
// fraccionaria, de modo que un valor que sí fuera un monto no pueda colarse por esta
// puerta sin que salte.
//
//nolint:forbidigo // float64 es la representación de un entero JSON, no de un monto.
func (s *State) Int32(key string) (int32, error) {
	raw, ok := s.Payload[key]
	if !ok {
		return 0, fmt.Errorf("%w: falta %q en el payload de la saga", ErrPayloadInvalid, key)
	}

	switch typed := raw.(type) {
	case int32:
		return typed, nil
	case float64:
		if typed != math.Trunc(typed) {
			return 0, fmt.Errorf("%w: %q = %v no es un entero", ErrPayloadInvalid, key, typed)
		}
		return int32(typed), nil
	default:
		return 0, fmt.Errorf("%w: %q es %T y se esperaba un entero", ErrPayloadInvalid, key, raw)
	}
}

// StringMap extrae del payload un mapa de cadenas.
//
// Acepta las DOS formas en que el mismo dato puede presentarse, y esa duplicidad no
// es un descuido del llamador: `map[string]string` es lo que deja quien arranca la
// saga en memoria, y `map[string]any` es lo que devuelve `encoding/json` al releer
// el payload de `saga_state` tras una reanudación. Tratar solo la primera haría que
// las sagas funcionaran siempre… salvo justo después de un reinicio.
func (s *State) StringMap(key string) (map[string]string, error) {
	raw, ok := s.Payload[key]
	if !ok {
		return nil, fmt.Errorf("%w: falta %q en el payload de la saga", ErrPayloadInvalid, key)
	}

	switch typed := raw.(type) {
	case map[string]string:
		return typed, nil
	case map[string]any:
		out := make(map[string]string, len(typed))
		for k, v := range typed {
			text, ok := v.(string)
			if !ok {
				return nil, fmt.Errorf("%w: %q[%q] es %T y se esperaba una cadena",
					ErrPayloadInvalid, key, k, v)
			}
			out[k] = text
		}
		return out, nil
	default:
		return nil, fmt.Errorf("%w: %q es %T y se esperaba un mapa de cadenas",
			ErrPayloadInvalid, key, raw)
	}
}

// Event es un evento de dominio producido por un paso.
//
// El paso lo DEVUELVE en lugar de publicarlo: la publicación la hace el motor,
// dentro de la misma transacción que el avance de la saga (research D-07). Si un
// paso publicara por su cuenta, se perdería esa atomicidad y con ella la garantía
// de que un avance confirmado tiene su evento registrado.
type Event struct {
	Type       string
	RoutingKey string

	// ActorRef es el UUID OPACO de quien provocó el evento (`events-catalog.md`).
	//
	// Lo declara el PASO y no lo deduce el motor, y esa es la única forma de que el
	// motor siga sin lógica de dominio (Principio VI): saber que el actor de la saga
	// de registro es el `user_id` recién creado, y el de la de calificación el
	// usuario que respondió, es conocimiento del flujo, no de la secuenciación.
	//
	// Es obligatorio. Auditoría exige que sea un UUID válido y manda a la
	// dead-letter lo que no lo sea, así que un paso que lo deje vacío produce un
	// evento que se pierde sin registrarse — justo lo contrario de auditar.
	ActorRef string

	Payload map[string]any
}

// Step es un paso con su compensación.
//
// Se modela como un struct de funciones y no como una interfaz por paso: hay
// alrededor de veinte pasos en total y una interfaz obligaría a un tipo con dos
// métodos por cada uno, la mayoría de una línea. Lo que importa del paso es su
// nombre y sus dos funciones, y así es exactamente lo que se declara.
type Step struct {
	// Name identifica el paso en el log y en `saga_state.compensations`. Se
	// persiste, así que cambiarlo rompe la reanudación de las sagas en vuelo.
	Name string

	// Do ejecuta el paso hacia delante. Devuelve los eventos que el avance produce.
	Do func(ctx context.Context, st *State) ([]Event, error)

	// Compensate deshace el paso. Puede ser nil cuando el paso no deja efecto que
	// deshacer —una lectura, o una escritura idempotente y monótona como
	// `Users.ApplyQuizScore` (D-07)—, y ese nil es información, no un descuido: el
	// motor lo salta y el log lo registra como «sin compensación necesaria».
	//
	// DEBE ser idempotente. El motor puede reintentarla tras un reinicio, y una
	// compensación que reste puntos dos veces es peor que no compensar.
	Compensate func(ctx context.Context, st *State) error
}

// Definition es una saga completa: su tipo y sus pasos en orden.
type Definition struct {
	// Type debe ser uno de los valores del CHECK `saga_state_type_valid`.
	Type  string
	Steps []Step
}
