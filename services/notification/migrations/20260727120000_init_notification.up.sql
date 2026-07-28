-- Servicio de Notificación — esquema inicial (notification_db).
--
-- COLA PERSISTENTE CON ESTADO (Constitución §"Entrega de Notificaciones").
-- Dos tablas, no una: la cola guarda lo PENDIENTE y el estado SOBREVIVE AL
-- DESENCOLADO, de modo que el resultado de cada intento sigue siendo auditable
-- después de que el evento deja la cola. Reemplaza la tabla única `email_outbox`
-- de versiones anteriores del modelo de datos.
--
-- Alcance: canal EMAIL únicamente. La bandeja in-app pertenece al Servicio de
-- Usuarios (plan.md N-03) porque Notificación es consumidor puro sin gRPC y no
-- puede servir lecturas al usuario.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── notification_events_queue: lo pendiente ────────────────────────────────
CREATE TABLE notification_events_queue (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id   UUID        NOT NULL UNIQUE,                 -- evento de origen; garantiza idempotencia
    recipient  TEXT        NOT NULL,
    template   TEXT        NOT NULL,
    payload    JSONB       NOT NULL DEFAULT '{}'::JSONB,
    attempts   INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT notification_events_queue_template_valid
        CHECK (template IN ('verificacion', 'cambio_password', 'alerta_seguridad')),
    CONSTRAINT notification_events_queue_attempts_non_negative
        CHECK (attempts >= 0),
    CONSTRAINT notification_events_queue_recipient_not_blank
        CHECK (length(btrim(recipient)) > 0)
);

COMMENT ON TABLE notification_events_queue IS
    'Eventos pendientes de entrega por email. Se DESENCOLA (DELETE) al alcanzar un desenlace terminal: éxito, o fallo con attempts >= MAX_ATTEMPTS. El resultado queda en notification_states.';

COMMENT ON COLUMN notification_events_queue.event_id IS
    'UNIQUE: reprocesar el mismo evento de origen no puede producir una notificación duplicada al usuario (constitución, regla 5 de la sección de entrega).';

-- El despachador lista los pendientes ordenados por created_at.
CREATE INDEX notification_events_queue_created_idx
    ON notification_events_queue (created_at);

-- ── notification_states: el resultado, sobrevive al desencolado ────────────
CREATE TABLE notification_states (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id   UUID        NOT NULL UNIQUE,                 -- correlaciona con el evento de origen
    state      TEXT        NOT NULL DEFAULT 'not_sent',
    attempts   INTEGER     NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT notification_states_state_valid
        CHECK (state IN ('not_sent', 'sent', 'failed')),
    CONSTRAINT notification_states_attempts_non_negative
        CHECK (attempts >= 0),
    -- Un fallo terminal debe registrar por qué; un envío exitoso no arrastra error.
    CONSTRAINT notification_states_failed_has_error
        CHECK (state <> 'failed' OR last_error IS NOT NULL),
    CONSTRAINT notification_states_sent_has_no_error
        CHECK (state <> 'sent' OR last_error IS NULL)
);

COMMENT ON TABLE notification_states IS
    'Estado persistente de cada evento de notificación. NO se elimina al desencolar: es el registro consultable de qué ocurrió (not_sent | sent | failed). Base de la medición de SC-007.';

-- Medición de SC-007 (95% entregadas en < 2 min) y diagnóstico de fallos.
CREATE INDEX notification_states_state_idx ON notification_states (state);
CREATE INDEX notification_states_updated_idx ON notification_states (updated_at);

COMMIT;
