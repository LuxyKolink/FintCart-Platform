package storer

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

// PostgresStorer es la implementación de [Storer] sobre `orchestrator_db`.
type PostgresStorer struct {
	db *sqlx.DB
}

// NewPostgresStorer construye el storer sobre un pool ya abierto (Principio X).
func NewPostgresStorer(db *sqlx.DB) *PostgresStorer {
	return &PostgresStorer{db: db}
}

// execTx ejecuta `fn` en una transacción: confirma si devuelve nil, revierte en
// cualquier otro caso (Principio XI regla 4).
//
// En este servicio es la pieza central y no una utilidad: la garantía de D-07
// —avance de saga y evento en la misma transacción— es exactamente lo que este
// helper implementa. El `*sqlx.Tx` no sale hacia `server`: el motor de saga decide
// QUÉ escribir, no cuándo empieza y acaba una transacción.
func (s *PostgresStorer) execTx(ctx context.Context, fn func(tx *sqlx.Tx) error) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return wrap("abrir transacción", err)
	}

	if err := fn(tx); err != nil {
		// `sql.ErrTxDone`: la transacción ya había terminado (contexto cancelado,
		// por ejemplo). No es un fallo del rollback y no debe tapar el error real.
		if rbErr := tx.Rollback(); rbErr != nil && !errors.Is(rbErr, sql.ErrTxDone) {
			return wrap("revertir transacción", errors.Join(err, rbErr))
		}
		return wrap("transacción abortada", err)
	}

	if err := tx.Commit(); err != nil {
		return wrap("confirmar transacción", err)
	}
	return nil
}

// sagaColumns se enumera en lugar de usar `SELECT *` porque `sqlx` falla si la
// tabla gana una columna que el struct no tiene, y una migración futura no debe
// romper una consulta que no le concierne.
const sagaColumns = `id, saga_type, status, current_step, payload, compensations,
                     last_error, created_at, updated_at`

// ── saga_state ──────────────────────────────────────────────────────────────

const createSagaQuery = `
INSERT INTO saga_state (saga_type, payload)
VALUES ($1, $2)
RETURNING id`

// CreateSaga inserta la saga en `running` en el paso 0 y devuelve su id.
//
// El `status` y el `current_step` iniciales los pone el DEFAULT del esquema y no
// esta sentencia: repetirlos aquí crearía una segunda definición de «recién creada»
// que podría desviarse de la del CHECK.
func (s *PostgresStorer) CreateSaga(ctx context.Context, sagaType string, payload []byte) (uuid.UUID, error) {
	var id uuid.UUID
	if err := s.db.QueryRowxContext(ctx, createSagaQuery, sagaType, payload).Scan(&id); err != nil {
		return uuid.Nil, wrap(fmt.Sprintf("crear saga de tipo %q", sagaType), err)
	}
	return id, nil
}

const getSagaQuery = `SELECT ` + sagaColumns + ` FROM saga_state WHERE id = $1`

// GetSaga lee el estado actual de una saga.
func (s *PostgresStorer) GetSaga(ctx context.Context, sagaID uuid.UUID) (SagaRow, error) {
	var row SagaRow
	err := s.db.GetContext(ctx, &row, getSagaQuery, sagaID)
	if errors.Is(err, sql.ErrNoRows) {
		return SagaRow{}, fmt.Errorf("%w: saga %s", ErrNotFound, sagaID)
	}
	if err != nil {
		return SagaRow{}, wrap(fmt.Sprintf("leer saga %s", sagaID), err)
	}
	return row, nil
}

// advanceSagaQuery mueve el puntero de la saga.
//
// La condición `current_step = $5` es el bloqueo optimista descrito en [Storer]:
// si otra ejecución de la misma saga ya avanzó, esta actualización no afecta a
// ninguna fila y el llamador recibe [ErrConflict] en lugar de aplicar el paso dos
// veces.
//
// `status IN ('running', 'compensating')` cierra el otro flanco: una saga ya
// terminada no puede reactivarse por una reanudación tardía.
const advanceSagaQuery = `
UPDATE saga_state
   SET current_step  = $2,
       payload       = $3,
       compensations = $4,
       updated_at    = now()
 WHERE id = $1
   AND current_step = $5
   AND status IN ('running', 'compensating')`

// enqueueEventQuery inserta un evento en el outbox.
//
// El `id` lo aporta el motor y no el DEFAULT de la tabla: ese id ES el `event_id`
// del sobre que viaja al broker, y los consumidores lo usan como clave de
// idempotencia. Dejarlo generar a la base obligaría a leerlo de vuelta para
// construir el sobre, y a que el sobre y la fila pudieran discrepar.
//
// `ON CONFLICT DO NOTHING` porque un reintento del mismo avance —tras un fallo de
// red al confirmar— no debe duplicar el evento.
const enqueueEventQuery = `
INSERT INTO event_outbox (id, saga_id, event_type, routing_key, payload)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (id) DO NOTHING`

// AdvanceSaga es la escritura crítica de D-07: `saga_state` + `event_outbox` en una
// sola transacción.
func (s *PostgresStorer) AdvanceSaga(
	ctx context.Context,
	sagaID uuid.UUID,
	fromStep, toStep int32,
	payload, compensations []byte,
	events []OutboxRow,
) error {
	return s.execTx(ctx, func(tx *sqlx.Tx) error {
		res, err := tx.ExecContext(ctx, advanceSagaQuery,
			sagaID, toStep, payload, compensations, fromStep)
		if err != nil {
			return wrap(fmt.Sprintf("avanzar saga %s al paso %d", sagaID, toStep), err)
		}

		affected, err := res.RowsAffected()
		if err != nil {
			return wrap("contar filas afectadas por el avance", err)
		}
		if affected == 0 {
			// No se distingue «no existe» de «ya avanzó»: en ambos casos esta
			// ejecución no debe continuar, y averiguar cuál de los dos es exigiría
			// una segunda consulta dentro de la misma transacción para producir un
			// mensaje que el motor trata igual.
			return fmt.Errorf("%w: la saga %s ya no está en el paso %d", ErrConflict, sagaID, fromStep)
		}

		for _, ev := range events {
			if _, err := tx.ExecContext(ctx, enqueueEventQuery,
				ev.ID, ev.SagaID, ev.EventType, ev.RoutingKey, ev.Payload); err != nil {
				return wrap(fmt.Sprintf("encolar el evento %s (%s)", ev.ID, ev.EventType), err)
			}
		}
		return nil
	})
}

const markStatusQuery = `
UPDATE saga_state
   SET status     = $2,
       last_error = $3,
       updated_at = now()
 WHERE id = $1`

// MarkStatus mueve la saga a un estado terminal o a `compensating`.
//
// No lleva bloqueo optimista sobre `current_step` a propósito: marcar el desenlace
// tiene que funcionar SIEMPRE, incluso si el paso cambió por medio. Una saga que
// falló y se quedara en `running` porque el marcado fue rechazado sería reanimada
// una y otra vez por [PostgresStorer.ListResumable].
func (s *PostgresStorer) MarkStatus(ctx context.Context, sagaID uuid.UUID, status string, lastErr error) error {
	// `*string` y no `string`: la columna es nullable y un desenlace correcto no
	// debe dejar la cadena vacía, que se leería como «hubo un error sin mensaje».
	var msg *string
	if lastErr != nil {
		text := lastErr.Error()
		msg = &text
	}

	if _, err := s.db.ExecContext(ctx, markStatusQuery, sagaID, status, msg); err != nil {
		return wrap(fmt.Sprintf("marcar la saga %s como %q", sagaID, status), err)
	}
	return nil
}

// resumeStaleAfter es la antigüedad mínima que debe tener una saga para que otra
// réplica la reclame.
//
// Sin este margen, arrancar una réplica nueva reclamaría sagas que la réplica
// vecina está ejecutando en ese mismo instante, y los dos procesos avanzarían los
// mismos pasos a la vez. El bloqueo optimista de `AdvanceSaga` evitaría el doble
// avance, pero no la doble llamada al RPC del paso.
const resumeStaleAfter = "1 minute"

// listResumableQuery reclama un lote de sagas a medias.
//
// Es un UPDATE y no un SELECT porque hace falta RECLAMAR, no solo leer: tocar
// `updated_at` marca el lote como «alguien se está ocupando de esto» y lo saca del
// alcance de las demás réplicas durante `resumeStaleAfter`.
//
// `FOR UPDATE SKIP LOCKED` en la subconsulta cierra la ventana entre seleccionar y
// actualizar: dos réplicas que barren a la vez se reparten el lote en lugar de
// pelearse por la misma fila.
const listResumableQuery = `
UPDATE saga_state
   SET updated_at = now()
 WHERE id IN (
        SELECT id
          FROM saga_state
         WHERE status IN ('running', 'compensating')
           AND updated_at < now() - INTERVAL '` + resumeStaleAfter + `'
         ORDER BY created_at
         LIMIT $1
           FOR UPDATE SKIP LOCKED
       )
RETURNING ` + sagaColumns

// ListResumable devuelve las sagas que quedaron a medias, reclamándolas.
func (s *PostgresStorer) ListResumable(ctx context.Context, limit int32) ([]SagaRow, error) {
	var rows []SagaRow
	if err := s.db.SelectContext(ctx, &rows, listResumableQuery, limit); err != nil {
		return nil, wrap("reclamar sagas reanudables", err)
	}
	return rows, nil
}

// ── event_outbox ────────────────────────────────────────────────────────────

const outboxColumns = `id, saga_id, event_type, routing_key, payload,
                       published_at, attempts, last_error, created_at`

// listPendingEventsQuery barre lo no publicado en orden de creación.
//
// NO lleva `FOR UPDATE SKIP LOCKED`, y conviene saber por qué: el bloqueo solo dura
// lo que dura su transacción, y aquí publicar y marcar ocurren en llamadas
// posteriores, fuera de ella. El bloqueo se soltaría antes de servir de nada.
//
// La consecuencia es que dos réplicas del relay pueden publicar el mismo evento.
// Es aceptable porque la entrega ya es AT-LEAST-ONCE por diseño (D-07): el proceso
// puede morir entre el publish y el marcado, así que los consumidores tienen que ser
// idempotentes por `event_id` de todas formas. La alternativa —marcar como publicado
// ANTES de publicar— cambiaría un duplicado ocasional por una pérdida silenciosa, y
// perder un evento de auditoría es mucho peor que registrarlo dos veces.
const listPendingEventsQuery = `
SELECT ` + outboxColumns + `
  FROM event_outbox
 WHERE published_at IS NULL
 ORDER BY created_at
 LIMIT $1`

// ListPendingEvents devuelve los eventos sin publicar en orden de creación.
func (s *PostgresStorer) ListPendingEvents(ctx context.Context, limit int32) ([]OutboxRow, error) {
	var rows []OutboxRow
	if err := s.db.SelectContext(ctx, &rows, listPendingEventsQuery, limit); err != nil {
		return nil, wrap("listar eventos pendientes del outbox", err)
	}
	return rows, nil
}

// markEventPublishedQuery sella el evento.
//
// `AND published_at IS NULL` mantiene la marca original si dos relays publicaron el
// mismo evento: la hora del primero es la buena, y sobrescribirla falsearía la
// medida del retardo entre confirmar la saga y publicar (SC-007).
const markEventPublishedQuery = `
UPDATE event_outbox
   SET published_at = now()
 WHERE id = $1
   AND published_at IS NULL`

// MarkEventPublished sella el evento con la hora de publicación.
func (s *PostgresStorer) MarkEventPublished(ctx context.Context, eventID uuid.UUID) error {
	if _, err := s.db.ExecContext(ctx, markEventPublishedQuery, eventID); err != nil {
		return wrap(fmt.Sprintf("marcar el evento %s como publicado", eventID), err)
	}
	return nil
}

const incrementEventAttemptsQuery = `
UPDATE event_outbox
   SET attempts   = attempts + 1,
       last_error = $2
 WHERE id = $1`

// IncrementEventAttempts registra un intento fallido de publicación.
//
// El contador y la causa viven en la FILA y no en memoria del publicador para que un
// evento que falla de forma sistemática sea visible en la base —y por tanto
// alertable— en lugar de reiniciar su cuenta en cada despliegue.
func (s *PostgresStorer) IncrementEventAttempts(ctx context.Context, eventID uuid.UUID, cause error) error {
	var msg *string
	if cause != nil {
		text := cause.Error()
		msg = &text
	}

	if _, err := s.db.ExecContext(ctx, incrementEventAttemptsQuery, eventID, msg); err != nil {
		return wrap(fmt.Sprintf("registrar el intento fallido del evento %s", eventID), err)
	}
	return nil
}
