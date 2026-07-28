-- Servicio de Usuarios — esquema inicial (users_db).
--
-- Dueño del perfil, roles, preferencias, progreso, historiales y la BANDEJA
-- IN-APP (plan.md N-03: Notificación es consumidor puro sin gRPC y no puede
-- servir lecturas al usuario, así que la bandeja vive aquí).
--
-- Principio III: `id` coincide con auth.credentials.id pero NO hay clave foránea
-- entre servicios — la correlación es por UUID opaco resuelto vía gRPC.
-- Principio VIII: `best_score` es NUMERIC, nunca REAL/DOUBLE PRECISION.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ── profiles ───────────────────────────────────────────────────────────────
CREATE TABLE profiles (
    id             UUID PRIMARY KEY,                        -- = auth.credentials.id (sin FK cruzada)
    email          CITEXT      NOT NULL,                    -- copia de perfil; anonimizable (FR-030)
    display_name   TEXT        NOT NULL,                    -- anonimizable
    email_verified BOOLEAN     NOT NULL DEFAULT FALSE,      -- FR-002
    account_status TEXT        NOT NULL DEFAULT 'active',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT profiles_account_status_valid
        CHECK (account_status IN ('active', 'anonymized'))
);

-- El correo es único solo entre cuentas activas: tras la anonimización (FR-030)
-- se sustituye por un valor opaco y varias cuentas anonimizadas pueden coexistir.
CREATE UNIQUE INDEX profiles_email_active_uniq
    ON profiles (email) WHERE account_status = 'active';

-- ── roles_assignment ───────────────────────────────────────────────────────
-- FR-006: un usuario puede tener ≥ 1 rol. La regla "un editor no publica su
-- propio artículo" NO se valida aquí: es un invariante de Aprendizaje sobre
-- article_versions (approved_by ≠ created_by), donde está el dato necesario.
CREATE TABLE roles_assignment (
    user_id     UUID        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    role        TEXT        NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, role),
    CONSTRAINT roles_assignment_role_valid
        CHECK (role IN ('usuario_final', 'editor', 'coordinador_editorial'))
);

-- ── preferences ────────────────────────────────────────────────────────────
CREATE TABLE preferences (
    user_id      UUID PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    locale       TEXT        NOT NULL DEFAULT 'es-CO',
    notif_inapp  BOOLEAN     NOT NULL DEFAULT TRUE,
    notif_email  BOOLEAN     NOT NULL DEFAULT TRUE,
    payload      JSONB       NOT NULL DEFAULT '{}'::JSONB,  -- preferencias extensibles
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── progress ───────────────────────────────────────────────────────────────
-- FR-014: puntos = Σ del mejor puntaje por cuestionario distinto.
CREATE TABLE progress (
    user_id    UUID PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    points     INTEGER     NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT progress_points_non_negative CHECK (points >= 0)
);

-- ── quiz_best_score ────────────────────────────────────────────────────────
-- Soporta el cálculo monótono de puntos (research D-07): ApplyQuizScore solo
-- actualiza si el nuevo puntaje SUPERA el almacenado, lo que hace la operación
-- idempotente y elimina la necesidad de compensación destructiva en la saga.
CREATE TABLE quiz_best_score (
    user_id    UUID          NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    quiz_id    UUID          NOT NULL,                      -- ID opaco de Aprendizaje
    best_score NUMERIC(6, 2) NOT NULL,                      -- Principio VIII: NUMERIC
    updated_at TIMESTAMPTZ   NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, quiz_id),
    CONSTRAINT quiz_best_score_non_negative CHECK (best_score >= 0)
);

-- ── article_views (FR-015) ─────────────────────────────────────────────────
CREATE TABLE article_views (
    user_id         UUID        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    article_id      UUID        NOT NULL,                   -- ID opaco de Aprendizaje
    first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    view_count      INTEGER     NOT NULL DEFAULT 1,

    PRIMARY KEY (user_id, article_id),
    CONSTRAINT article_views_count_positive CHECK (view_count > 0)
);

-- ── inapp_notifications (FR-023, plan.md N-03) ─────────────────────────────
CREATE TABLE inapp_notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    type       TEXT        NOT NULL,
    payload    JSONB       NOT NULL DEFAULT '{}'::JSONB,
    read_state TEXT        NOT NULL DEFAULT 'unread',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at    TIMESTAMPTZ,

    CONSTRAINT inapp_notifications_type_valid
        CHECK (type IN ('nuevo_articulo', 'recordatorio', 'hito_progreso', 'resultado_cuestionario')),
    CONSTRAINT inapp_notifications_read_state_valid
        CHECK (read_state IN ('unread', 'read')),
    -- read_at existe si y solo si está leída: evita estados incoherentes.
    CONSTRAINT inapp_notifications_read_at_matches_state
        CHECK ((read_state = 'read' AND read_at IS NOT NULL)
            OR (read_state = 'unread' AND read_at IS NULL))
);

-- Listado de la bandeja: más recientes primero, filtrando por usuario.
CREATE INDEX inapp_notifications_user_created_idx
    ON inapp_notifications (user_id, created_at DESC);

-- Contador de no leídas.
CREATE INDEX inapp_notifications_unread_idx
    ON inapp_notifications (user_id) WHERE read_state = 'unread';

COMMIT;
