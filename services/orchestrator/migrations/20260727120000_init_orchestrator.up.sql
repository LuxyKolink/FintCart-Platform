-- Orquestador — esquema inicial (orchestrator_db).
--
-- Principio VI: el Orquestador NO contiene lógica de dominio. Estas tablas solo
-- guardan el ESTADO de secuenciación de sagas y el outbox de eventos; ningún
-- dato de negocio de otro bounded context se persiste aquí.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── saga_state ─────────────────────────────────────────────────────────────
CREATE TABLE saga_state (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    saga_type     TEXT        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'running',
    current_step  INTEGER     NOT NULL DEFAULT 0,
    payload       JSONB       NOT NULL DEFAULT '{}'::JSONB,
    compensations JSONB       NOT NULL DEFAULT '[]'::JSONB,
    last_error    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT saga_state_type_valid
        CHECK (saga_type IN ('registro', 'verificacion_email', 'calificacion',
                             'simulacion', 'actividad', 'anonimizacion')),
    CONSTRAINT saga_state_status_valid
        CHECK (status IN ('running', 'completed', 'compensating', 'failed')),
    CONSTRAINT saga_state_current_step_non_negative CHECK (current_step >= 0)
);

-- Reanudación tras un reinicio: recuperar las sagas que quedaron a medias.
CREATE INDEX saga_state_resumable_idx
    ON saga_state (created_at) WHERE status IN ('running', 'compensating');

CREATE INDEX saga_state_type_status_idx ON saga_state (saga_type, status);

-- ── event_outbox (research D-07: publicación confiable) ────────────────────
-- El evento se escribe en la MISMA transacción que el avance de la saga; un
-- publicador aparte lo envía a RabbitMQ y lo marca como publicado. Así no se
-- pierde un evento si el proceso muere entre el commit y el publish.
CREATE TABLE event_outbox (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    saga_id      UUID        REFERENCES saga_state (id) ON DELETE CASCADE,
    event_type   TEXT        NOT NULL,
    routing_key  TEXT        NOT NULL,
    payload      JSONB       NOT NULL,
    published_at TIMESTAMPTZ,
    attempts     INTEGER     NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Solo los eventos cuyo productor es el Orquestador (contracts/events).
    CONSTRAINT event_outbox_event_type_valid
        CHECK (event_type IN ('user.registered', 'user.email_verified',
                              'learning.quiz_graded', 'user.progress_milestone',
                              'user.activity', 'simulation.executed',
                              'account.anonymized')),
    CONSTRAINT event_outbox_attempts_non_negative CHECK (attempts >= 0)
);

-- El publicador barre lo no publicado en orden de creación.
CREATE INDEX event_outbox_pending_idx
    ON event_outbox (created_at) WHERE published_at IS NULL;

COMMIT;
