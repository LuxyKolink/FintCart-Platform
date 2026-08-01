package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/fintcart/platform/services/orchestrator/internal/events"
	"github.com/fintcart/platform/services/orchestrator/internal/server/steps"
	"github.com/fintcart/platform/services/orchestrator/internal/storer"
)

// Motor de sagas (Constitución Principio VI).
//
// Es la única forma permitida de consistencia multi-servicio en la plataforma: sin
// 2PC y sin bloqueos distribuidos. El motor secuencia pasos hacia delante y, si uno
// falla, ejecuta las compensaciones de los ya completados en orden INVERSO.
//
// Tres propiedades que el motor debe garantizar y que no son opcionales:
//
//  1. **Persistencia del avance.** Cada paso completado se registra en
//     `saga_state` junto con sus eventos, en una sola transacción (D-07). Una saga
//     que solo viviera en memoria dejaría, tras un reinicio, un perfil creado sin
//     credencial y sin nadie que recordara el pendiente.
//  2. **Reanudación.** Al arrancar se recuperan las sagas en `running` o
//     `compensating` y se continúan desde `current_step`. Es la contrapartida de
//     (1): persistir sin reanudar solo produce filas huérfanas.
//  3. **Compensación en orden inverso.** Deshacer en el mismo orden en que se hizo
//     puede violar dependencias entre pasos —anonimizar la credencial antes de
//     revocar las sesiones abre justo la ventana que la saga quería cerrar.
//
// El invariante que hace posible (2) y (3) a la vez es que
// `len(compensations) == current_step`: la columna guarda el nombre de CADA paso
// completado, tenga compensación o no. Guardar solo los compensables ahorraría unas
// pocas cadenas y a cambio rompería la correspondencia entre la posición en la lista
// y el número de paso, que es de donde el motor saca qué deshacer al reanudar.

// SagaStatus es la vista de dominio del estado de una saga.
type SagaStatus struct {
	SagaID      string
	SagaType    string
	Status      string
	CurrentStep int32
}

// Engine ejecuta definiciones de saga contra la persistencia.
type Engine struct {
	store  storer.Storer
	logger *slog.Logger
	defs   map[string]steps.Definition

	// wg cuenta las sagas que corren en segundo plano, para que el apagado pueda
	// esperarlas. Sin esta espera, un SIGTERM cortaría una saga entre dos pasos y
	// la dejaría a medias hasta que otra réplica la reanudara — recuperable, pero
	// con un retraso de minutos en un registro que el usuario está esperando.
	wg sync.WaitGroup
}

// NewEngine registra las definiciones por tipo.
//
// Recibe las definiciones ya construidas (con sus clientes gRPC inyectados) en lugar
// de construirlas: así el motor no conoce ningún servicio participante, que es lo
// que lo mantiene libre de dominio.
func NewEngine(store storer.Storer, logger *slog.Logger, defs ...steps.Definition) *Engine {
	byType := make(map[string]steps.Definition, len(defs))
	for _, d := range defs {
		byType[d.Type] = d
	}
	return &Engine{store: store, logger: logger, defs: byType}
}

// Errores propios del motor.
var (
	// ErrUnknownSagaType se devuelve si se pide un tipo no registrado.
	//
	// Es un error propio y no un pánico porque el CHECK del esquema y el mapa de
	// definiciones pueden desincronizarse —el esquema admite seis tipos— y el fallo
	// debe ser un error manejable, no una caída del proceso.
	ErrUnknownSagaType = errors.New("server: tipo de saga desconocido")

	// ErrSagaFailed envuelve el fallo que provocó la compensación.
	ErrSagaFailed = errors.New("server: saga fallida y compensada")

	// ErrInvalidEvent marca un evento que un paso construyó mal.
	//
	// Se detecta ANTES de escribirlo en el outbox. Si se dejara pasar, el evento se
	// publicaría, Auditoría lo rechazaría como mal formado y acabaría en la
	// dead-letter: un registro perdido cuya causa está a tres saltos del síntoma.
	ErrInvalidEvent = errors.New("server: evento de saga inválido")
)

// errResumedCompensation es la causa que se registra al retomar una compensación
// interrumpida. No sustituye a la causa original —esa quedó en `last_error` cuando la
// saga pasó a `compensating`—, solo deja constancia de que hubo un segundo intento.
var errResumedCompensation = errors.New("server: compensación interrumpida y reanudada")

// sagaExecutionTimeout acota lo que puede durar una saga desatendida.
//
// Existe porque el contexto de las sagas asíncronas se desacopla del de la petición
// (ver [Engine.Start]), y un contexto sin plazo alguno convierte a un participante
// colgado en una goroutine inmortal: el apagado nunca terminaría y la saga nunca
// quedaría marcada para reanudar.
const sagaExecutionTimeout = 2 * time.Minute

// compensationTimeout acota la fase de compensación.
//
// Es un plazo aparte y más generoso que el de un paso normal a propósito: deshacer
// ocurre cuando algo ya ha ido mal —a menudo un participante lento o a medio
// reiniciar— y abandonar la compensación por prisa deja exactamente el estado
// inconsistente que la saga existe para evitar.
const compensationTimeout = 5 * time.Minute

// Start crea la saga y la ejecuta EN SEGUNDO PLANO, devolviendo su handle.
//
// La ejecución no bloquea al llamador porque los flujos que usan `Start` —registro,
// verificación, anonimización— son asíncronos por contrato: el cliente recibe un
// `SagaHandle` con el que consultar el estado. Los flujos síncronos usan
// [Engine.Execute].
//
// El contexto de ejecución se DESACOPLA del de la petición gRPC con
// `context.WithoutCancel`. Si no se hiciera, un cliente que corta la conexión
// cancelaría la saga entre dos pasos y la dejaría con la credencial creada y sin
// perfil. Se conservan los valores del contexto —de ahí `WithoutCancel` y no un
// `context.Background()` pelado— para que la traza de la petición siga acompañando
// a los pasos en el log.
// `secrets` son los datos que los pasos necesitan y que NO se persisten (la
// contraseña del registro). Ver [steps.State.Secrets]: no sobreviven a un reinicio,
// y esa es justo la propiedad que se busca.
func (e *Engine) Start(
	ctx context.Context,
	sagaType string,
	payload map[string]any,
	secrets map[string]string,
) (uuid.UUID, error) {
	def, sagaID, err := e.create(ctx, sagaType, payload)
	if err != nil {
		return uuid.Nil, err
	}

	row, err := e.store.GetSaga(ctx, sagaID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("releer la saga %s recién creada: %w", sagaID, err)
	}

	e.launch(ctx, def, row, secrets)
	return sagaID, nil
}

// Execute crea la saga y espera su resultado, devolviendo su identificador y el
// payload final.
//
// Lo usan los flujos síncronos (calificación, simulación, verificación de correo):
// el usuario está esperando su nota, el resultado de la simulación o la confirmación
// de que su enlace valía, y devolver un handle para que el Gateway sondee
// convertiría una interacción inmediata en un bucle de espera.
//
// El identificador se devuelve JUNTO al resultado y no solo en caso de éxito: es lo
// único con lo que se puede rastrear después una ejecución que falló, que es
// precisamente cuando hace falta.
//
// A diferencia de [Engine.Start], los pasos hacia delante SÍ corren con el contexto
// del llamador: si quien espera se marcha, no tiene sentido seguir gastando llamadas
// a los participantes. La compensación, en cambio, se desacopla igualmente — deshacer
// no es opcional por mucho que el cliente ya no esté escuchando.
func (e *Engine) Execute(
	ctx context.Context,
	sagaType string,
	payload map[string]any,
	secrets map[string]string,
) (uuid.UUID, map[string]any, error) {
	def, sagaID, err := e.create(ctx, sagaType, payload)
	if err != nil {
		return uuid.Nil, nil, err
	}

	row, err := e.store.GetSaga(ctx, sagaID)
	if err != nil {
		return sagaID, nil, fmt.Errorf("releer la saga %s recién creada: %w", sagaID, err)
	}

	final, err := e.run(ctx, def, row, secrets)
	return sagaID, final, err
}

// create valida el tipo y persiste la saga en su estado inicial.
func (e *Engine) create(ctx context.Context, sagaType string, payload map[string]any) (steps.Definition, uuid.UUID, error) {
	def, ok := e.defs[sagaType]
	if !ok {
		return steps.Definition{}, uuid.Nil, fmt.Errorf("%w: %q", ErrUnknownSagaType, sagaType)
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return steps.Definition{}, uuid.Nil, fmt.Errorf("serializar payload de la saga %s: %w", sagaType, err)
	}

	sagaID, err := e.store.CreateSaga(ctx, sagaType, raw)
	if err != nil {
		return steps.Definition{}, uuid.Nil, fmt.Errorf("crear saga %s: %w", sagaType, err)
	}
	return def, sagaID, nil
}

// launch ejecuta la saga en una goroutine contabilizada por [Engine.Wait].
func (e *Engine) launch(ctx context.Context, def steps.Definition, row storer.SagaRow, secrets map[string]string) {
	runCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), sagaExecutionTimeout)

	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		defer cancel()

		if _, err := e.run(runCtx, def, row, secrets); err != nil {
			// El error se registra y no se propaga: no hay nadie esperándolo. El
			// estado real queda en `saga_state`, que es lo que consultará
			// `GetSagaStatus` y lo que verá quien opere la plataforma.
			e.logger.ErrorContext(runCtx, "saga en segundo plano terminada con fallo",
				slog.String("saga_id", row.ID.String()),
				slog.String("saga_type", def.Type),
				slog.String("error", err.Error()),
			)
		}
	}()
}

// Wait espera a que terminen las sagas en segundo plano, o a que venza el plazo.
//
// Devuelve false si el plazo venció con sagas aún vivas. El llamador (el entrypoint)
// puede entonces registrar que el apagado deja trabajo a medias, en lugar de cerrar
// la base bajo los pies de una saga en curso y producir un error de «connection
// closed» que no se parece en nada a su causa.
func (e *Engine) Wait(timeout time.Duration) bool {
	done := make(chan struct{})
	go func() {
		e.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		return true
	case <-time.After(timeout):
		return false
	}
}

// Status consulta el estado de una saga (RPC `GetSagaStatus`).
func (e *Engine) Status(ctx context.Context, sagaID uuid.UUID) (SagaStatus, error) {
	row, err := e.store.GetSaga(ctx, sagaID)
	if err != nil {
		return SagaStatus{}, fmt.Errorf("leer estado de la saga %s: %w", sagaID, err)
	}
	return sagaStatusFromRow(row), nil
}

// Resume retoma las sagas que quedaron a medias. Se llama al arrancar.
//
// Un límite de lote acotado y no «todas»: tras una caída prolongada puede haber
// miles de sagas pendientes, y cargarlas de golpe al arrancar convertiría la
// recuperación en una segunda caída.
//
// No bloquea: cada saga recuperada se lanza en segundo plano. Reanudarlas en serie
// antes de servir dejaría el proceso sin atender RPC durante todo el rescate, y un
// pod que no responde a su sonda de vivacidad se reinicia — reiniciando también el
// rescate, indefinidamente.
func (e *Engine) Resume(ctx context.Context, limit int32) error {
	pending, err := e.store.ListResumable(ctx, limit)
	if err != nil {
		return fmt.Errorf("listar sagas reanudables: %w", err)
	}

	for _, row := range pending {
		def, ok := e.defs[row.SagaType]
		if !ok {
			// Una saga de un tipo que este binario no conoce se DEJA como está. Es el
			// caso de un despliegue mixto en el que la versión anterior arrancó un
			// flujo que esta ya no tiene: marcarla `failed` sin compensar destruiría
			// la información que necesita la réplica que sí sabe terminarla.
			e.logger.WarnContext(ctx, "saga reanudable de tipo desconocido; se deja intacta",
				slog.String("saga_id", row.ID.String()),
				slog.String("saga_type", row.SagaType),
			)
			continue
		}

		e.logger.InfoContext(ctx, "reanudando saga",
			slog.String("saga_id", row.ID.String()),
			slog.String("saga_type", row.SagaType),
			slog.String("status", row.Status),
			slog.Int("current_step", int(row.CurrentStep)),
		)
		// Sin secretos: se perdieron con el proceso anterior. Es deliberado — la
		// alternativa habría sido persistirlos, que es justo lo que no puede hacerse.
		// Un paso que los necesite fallará y la saga compensará.
		e.launch(ctx, def, row, nil)
	}
	return nil
}

// ── ejecución ───────────────────────────────────────────────────────────────

// run ejecuta una saga desde donde la fila diga que está.
//
// Es el único camino de ejecución: arrancar y reanudar difieren solo en la fila de
// partida. Tener dos bucles —uno para empezar y otro para continuar— habría
// significado que la reanudación es un camino que casi nunca se recorre y que, por
// tanto, casi nunca se prueba.
func (e *Engine) run(
	ctx context.Context,
	def steps.Definition,
	row storer.SagaRow,
	secrets map[string]string,
) (map[string]any, error) {
	st, completed, err := stateFromRow(def, row, secrets)
	if err != nil {
		// La fila no se puede interpretar: no hay forma de ejecutar ni de compensar,
		// porque no se sabe qué pasos se aplicaron. Queda marcada para que alguien lo
		// mire, en lugar de reintentarse en cada arranque.
		cause := fmt.Errorf("estado ilegible de la saga %s: %w", row.ID, err)
		e.markStatus(ctx, row.ID, storer.StatusFailed, cause)
		return nil, cause
	}

	if row.Status == storer.StatusCompensating {
		// Una saga que murió compensando retoma las COMPENSACIONES pendientes, no los
		// pasos hacia delante. Por eso `compensating` es un estado propio y no un
		// `failed` temprano: la diferencia entre los dos es qué hay que hacer ahora.
		//
		// La causa original se arrastra desde `last_error` en lugar de sustituirse:
		// `MarkStatus` sobrescribe la columna, y perder el motivo por el que la saga
		// empezó a compensar dejaría en la fila solo el hecho de que se reintentó.
		cause := error(errResumedCompensation)
		if row.LastError != nil {
			cause = fmt.Errorf("%w (causa original: %s)", errResumedCompensation, *row.LastError)
		}
		return st.Payload, e.compensate(ctx, def, st, completed, nil, cause)
	}

	// El índice es `int32` y no `int` para que coincida con `current_step`: la columna
	// es `INTEGER`, y convertir en cada uso obligaría a razonar sobre desbordamientos
	// que el esquema ya impide.
	for i := row.CurrentStep; int(i) < len(def.Steps); i++ {
		step := def.Steps[i]

		produced, err := step.Do(ctx, st)
		if err != nil {
			// El paso no llegó a aplicarse, así que no entra en la lista a deshacer.
			cause := fmt.Errorf("paso %d (%s): %w", i, step.Name, err)
			return st.Payload, e.compensate(ctx, def, st, completed, nil, cause)
		}

		outbox, err := outboxRows(row.ID, produced)
		if err != nil {
			// El paso YA surtió efecto pero su evento es inválido, así que el avance
			// nunca se va a poder confirmar. Se pasa el paso como `unrecorded`: hay que
			// deshacerlo aunque la base no sepa que ocurrió. Dejarlo avanzar sería peor
			// —una saga cuyo evento nunca se podrá auditar rompe FR-025 en silencio— y
			// reintentarlo tampoco sirve: un sobre mal construido lo estará igual la
			// próxima vez.
			cause := fmt.Errorf("paso %d (%s): %w", i, step.Name, err)
			return st.Payload, e.compensate(ctx, def, st, completed, &step, cause)
		}

		completed = append(completed, step.Name)
		st.Step = i + 1

		if err := e.advance(ctx, row.ID, i, st, completed, outbox); err != nil {
			// NO se compensa. La escritura no se confirmó, así que lo que la base
			// recuerda es que el paso no se dio; deshacerlo dejaría el registro
			// diciendo una cosa y el mundo otra. La saga se queda en `running` y la
			// reanudación repite el paso — de ahí que `Do` deba ser idempotente.
			return st.Payload, err
		}
	}

	e.markStatus(ctx, row.ID, storer.StatusCompleted, nil)
	return st.Payload, nil
}

// advance persiste el avance de un paso junto con sus eventos (D-07).
func (e *Engine) advance(
	ctx context.Context,
	sagaID uuid.UUID,
	fromStep int32,
	st *steps.State,
	completed []string,
	outbox []storer.OutboxRow,
) error {
	payload, err := json.Marshal(st.Payload)
	if err != nil {
		return fmt.Errorf("serializar el payload de la saga %s: %w", sagaID, err)
	}
	comps, err := json.Marshal(completed)
	if err != nil {
		return fmt.Errorf("serializar las compensaciones de la saga %s: %w", sagaID, err)
	}

	if err := e.store.AdvanceSaga(ctx, sagaID, fromStep, fromStep+1, payload, comps, outbox); err != nil {
		if errors.Is(err, storer.ErrConflict) {
			// Otra ejecución de la misma saga se adelantó. Esta se retira sin tocar
			// nada: compensar aquí desharía pasos que la otra está usando.
			e.logger.WarnContext(ctx, "otra ejecución avanzó esta saga; esta se retira",
				slog.String("saga_id", sagaID.String()),
				slog.Int("from_step", int(fromStep)),
			)
		}
		return fmt.Errorf("avanzar la saga %s del paso %d: %w", sagaID, fromStep, err)
	}
	return nil
}

// compensate deshace los pasos completados en orden inverso.
//
// Corre con un contexto DESACOPLADO del que trajo el fallo. Es deliberado: la causa
// más común de que un paso falle es que el contexto se cancelara, y compensar con ese
// mismo contexto fallaría de inmediato en la primera compensación — dejando la saga a
// medias justo en el escenario para el que existe.
// `unrecorded` es el paso que se aplicó sin que su avance llegara a confirmarse. Su
// compensación se intenta primero y NO se persiste, porque no hay nada que retroceder:
// la base nunca supo de él. Es el único punto del motor que depende de la
// idempotencia de una compensación en lugar del registro.
func (e *Engine) compensate(
	ctx context.Context,
	def steps.Definition,
	st *steps.State,
	completed []string,
	unrecorded *steps.Step,
	cause error,
) error {
	compCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), compensationTimeout)
	defer cancel()

	sagaID, err := uuid.Parse(st.SagaID)
	if err != nil {
		return fmt.Errorf("saga_id %q ilegible durante la compensación: %w", st.SagaID, err)
	}

	e.logger.WarnContext(compCtx, "saga fallida; compensando",
		slog.String("saga_id", st.SagaID),
		slog.String("saga_type", def.Type),
		slog.Int("pasos_a_deshacer", len(completed)),
		slog.String("causa", cause.Error()),
	)
	e.markStatus(compCtx, sagaID, storer.StatusCompensating, cause)

	if unrecorded != nil && unrecorded.Compensate != nil {
		if err := unrecorded.Compensate(compCtx, st); err != nil {
			e.logger.ErrorContext(compCtx, "no se pudo deshacer un paso aplicado sin registrar",
				slog.String("saga_id", st.SagaID),
				slog.String("paso", unrecorded.Name),
				slog.String("error", err.Error()),
			)
		}
	}

	for i := len(completed) - 1; i >= 0; i-- {
		name := completed[i]

		step, ok := findStep(def, name)
		switch {
		case !ok:
			// La definición ya no incluye ese paso: un despliegue lo renombró o lo
			// quitó mientras la saga estaba en vuelo. No se puede deshacer lo que ya no
			// se sabe hacer, así que se registra y se sigue con los anteriores —
			// abandonar aquí dejaría también sin deshacer los que sí se conocen.
			e.logger.ErrorContext(compCtx, "paso completado sin definición; no se puede compensar",
				slog.String("saga_id", st.SagaID),
				slog.String("paso", name),
			)
		case step.Compensate == nil:
			e.logger.DebugContext(compCtx, "paso sin compensación necesaria",
				slog.String("saga_id", st.SagaID),
				slog.String("paso", name),
			)
		default:
			if err := step.Compensate(compCtx, st); err != nil {
				// La saga se QUEDA en `compensating`, no pasa a `failed`. Es la
				// diferencia entre «quedó a medias y hay que retomarlo» y «terminó
				// mal»: solo el primer estado vuelve a intentarse en la reanudación, y
				// una compensación pendiente no puede darse por perdida.
				failure := fmt.Errorf("compensar %q: %w (causa original: %w)", name, err, cause)
				e.logger.ErrorContext(compCtx, "compensación fallida; la saga queda pendiente de reintento",
					slog.String("saga_id", st.SagaID),
					slog.String("paso", name),
					slog.String("error", err.Error()),
				)
				e.markStatus(compCtx, sagaID, storer.StatusCompensating, failure)
				return failure
			}
		}

		// El avance de la compensación se persiste paso a paso, no al final: si el
		// proceso muere a mitad de deshacer, la reanudación tiene que saber cuáles ya
		// se deshicieron. Repetirlas sería tolerable —deben ser idempotentes— pero
		// dependeríamos de esa propiedad en lugar de del registro.
		if err := e.recordCompensation(compCtx, sagaID, st, completed[:i]); err != nil {
			return err
		}
	}

	e.markStatus(compCtx, sagaID, storer.StatusFailed, cause)
	return fmt.Errorf("%w (%s): %w", ErrSagaFailed, def.Type, cause)
}

// recordCompensation retrocede el puntero de la saga tras deshacer un paso.
func (e *Engine) recordCompensation(
	ctx context.Context,
	sagaID uuid.UUID,
	st *steps.State,
	remaining []string,
) error {
	payload, err := json.Marshal(st.Payload)
	if err != nil {
		return fmt.Errorf("serializar el payload de la saga %s: %w", sagaID, err)
	}
	comps, err := json.Marshal(remaining)
	if err != nil {
		return fmt.Errorf("serializar las compensaciones de la saga %s: %w", sagaID, err)
	}

	// La conversión es segura por construcción: `remaining` no puede tener más
	// elementos que pasos la definición, y esas caben de sobra en el `INTEGER` de
	// `current_step`. Una saga con 2^31 pasos no sería representable en el esquema.
	from := int32(len(remaining) + 1) //nolint:gosec // Acotado por len(def.Steps): ver arriba.
	// Sin eventos: deshacer un paso no produce eventos de dominio. Publicar un
	// «se deshizo X» obligaría a Auditoría a reconciliar pares de eventos para saber
	// qué ocurrió de verdad; el hecho auditable es el desenlace de la saga.
	if err := e.store.AdvanceSaga(ctx, sagaID, from, from-1, payload, comps, nil); err != nil {
		return fmt.Errorf("registrar la compensación de la saga %s en el paso %d: %w", sagaID, from, err)
	}
	st.Step = from - 1
	return nil
}

// markStatus registra el desenlace sin propagar su error.
//
// Un fallo al MARCAR no cambia lo que ocurrió, y devolverlo taparía la causa real con
// un error de escritura. Queda en el log, y la saga sigue en `running` o
// `compensating`, de modo que la reanudación la vuelve a mirar.
func (e *Engine) markStatus(ctx context.Context, sagaID uuid.UUID, status string, cause error) {
	if err := e.store.MarkStatus(ctx, sagaID, status, cause); err != nil {
		e.logger.ErrorContext(ctx, "no se pudo registrar el desenlace de la saga",
			slog.String("saga_id", sagaID.String()),
			slog.String("status", status),
			slog.String("error", err.Error()),
		)
	}
}

// ── conversión fila ↔ estado ────────────────────────────────────────────────

// stateFromRow reconstruye el estado vivo de la saga a partir de su fila.
//
// Comprueba el invariante `len(compensations) == current_step`. Una fila que no lo
// cumple no se puede compensar con garantías —no se sabe qué paso corresponde a qué
// nombre— y es preferible detenerse que deshacer el paso equivocado.
func stateFromRow(def steps.Definition, row storer.SagaRow, secrets map[string]string) (*steps.State, []string, error) {
	payload := map[string]any{}
	if len(row.Payload) > 0 {
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			return nil, nil, fmt.Errorf("interpretar el payload: %w", err)
		}
	}
	// `json.Unmarshal` sobre el literal `null` deja el mapa en NIL, no vacío. Una
	// saga arrancada sin payload —o cuya columna quedó en `null`— entregaría entonces
	// a los pasos un mapa en el que escribir es un pánico, y el primer paso que
	// intentara guardar el `user_id` reventaría la goroutine de la saga.
	if payload == nil {
		payload = map[string]any{}
	}

	completed := []string{}
	if len(row.Compensations) > 0 {
		if err := json.Unmarshal(row.Compensations, &completed); err != nil {
			return nil, nil, fmt.Errorf("interpretar las compensaciones: %w", err)
		}
	}
	if completed == nil {
		completed = []string{}
	}

	if int(row.CurrentStep) != len(completed) {
		return nil, nil, fmt.Errorf(
			"current_step (%d) no coincide con los pasos registrados (%d)",
			row.CurrentStep, len(completed))
	}
	if int(row.CurrentStep) > len(def.Steps) {
		return nil, nil, fmt.Errorf(
			"current_step (%d) excede los %d pasos de la definición %q",
			row.CurrentStep, len(def.Steps), def.Type)
	}

	return &steps.State{
		SagaID:  row.ID.String(),
		Type:    row.SagaType,
		Step:    row.CurrentStep,
		Payload: payload,
		// Los secretos vienen del LLAMADOR y nunca de la fila: no están en la fila
		// justamente porque no se persisten (ver [steps.State.Secrets]).
		Secrets: secrets,
	}, completed, nil
}

// findStep localiza un paso por su nombre persistido.
func findStep(def steps.Definition, name string) (steps.Step, bool) {
	for _, s := range def.Steps {
		if s.Name == name {
			return s, true
		}
	}
	return steps.Step{}, false
}

// outboxRows envuelve los eventos de un paso en el sobre del catálogo.
//
// El `event_id` del sobre ES el id de la fila del outbox, y no dos identificadores
// distintos: los consumidores usan `event_id` como clave de idempotencia frente a la
// entrega at-least-once (D-07), así que tiene que ser estable entre reintentos de
// publicación de la misma fila.
func outboxRows(sagaID uuid.UUID, produced []steps.Event) ([]storer.OutboxRow, error) {
	if len(produced) == 0 {
		return nil, nil
	}

	rows := make([]storer.OutboxRow, 0, len(produced))
	occurredAt := time.Now().UTC().Format(time.RFC3339)

	for _, ev := range produced {
		if ev.Type == "" {
			return nil, fmt.Errorf("%w: evento sin event_type", ErrInvalidEvent)
		}
		// El `actor_ref` se valida aquí y no al publicar: Auditoría manda a la
		// dead-letter todo sobre cuyo actor no sea un UUID, y ese descarte ocurre a
		// tres saltos del paso que lo construyó mal.
		if _, err := uuid.Parse(ev.ActorRef); err != nil {
			return nil, fmt.Errorf("%w: actor_ref %q del evento %q no es un UUID",
				ErrInvalidEvent, ev.ActorRef, ev.Type)
		}

		eventID := uuid.New()
		payload := ev.Payload
		if payload == nil {
			// `nil` se serializaría como `null` y la columna es `JSONB NOT NULL` con
			// DEFAULT `{}`. Un objeto vacío dice «este evento no lleva datos»; `null`
			// obliga a cada consumidor a distinguir los dos casos por su cuenta.
			payload = map[string]any{}
		}

		body, err := json.Marshal(events.Envelope{
			EventID:    eventID.String(),
			EventType:  ev.Type,
			OccurredAt: occurredAt,
			ActorRef:   ev.ActorRef,
			Payload:    payload,
		})
		if err != nil {
			return nil, fmt.Errorf("%w: serializar el evento %q: %w", ErrInvalidEvent, ev.Type, err)
		}

		routingKey := ev.RoutingKey
		if routingKey == "" {
			routingKey = ev.Type
		}

		saga := sagaID
		rows = append(rows, storer.OutboxRow{
			ID:         eventID,
			SagaID:     &saga,
			EventType:  ev.Type,
			RoutingKey: routingKey,
			Payload:    body,
		})
	}
	return rows, nil
}
