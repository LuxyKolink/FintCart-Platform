-- Servicio de Aprendizaje — esquema inicial (learning_db).
--
-- Registro autoritativo de contenido y evaluación (research D-06). El PROGRESO
-- no vive aquí: lo agrega el Servicio de Usuarios. Aprendizaje guarda TODOS los
-- intentos (FR-016); Usuarios deriva el mejor puntaje para los puntos (FR-014).
--
-- Principio VIII: score, weight y pass_threshold son NUMERIC(6,2). REAL,
-- DOUBLE PRECISION y FLOAT están PROHIBIDOS.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── articles ───────────────────────────────────────────────────────────────
CREATE TABLE articles (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title              TEXT        NOT NULL,
    category           TEXT        NOT NULL,                -- ≥ 5 categorías temáticas (SC-009)
    current_version_id UUID,                                -- versión publicada vigente; FK diferida abajo
    author_id          UUID        NOT NULL,                -- editor creador (ID opaco de Usuarios)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT articles_title_not_blank CHECK (length(btrim(title)) > 0)
);

-- ── article_versions (FR-013: trazabilidad histórica) ──────────────────────
CREATE TABLE article_versions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id   UUID        NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
    version_no   INTEGER     NOT NULL,
    body         TEXT        NOT NULL,
    state        TEXT        NOT NULL DEFAULT 'borrador',
    created_by   UUID        NOT NULL,                      -- editor (ID opaco)
    approved_by  UUID,                                      -- coordinador editorial (ID opaco)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,

    UNIQUE (article_id, version_no),

    CONSTRAINT article_versions_state_valid
        CHECK (state IN ('borrador', 'en_revision', 'publicado', 'archivado')),

    CONSTRAINT article_versions_version_no_positive CHECK (version_no > 0),

    -- FR-008 (separación de responsabilidades): un editor NO puede aprobar ni
    -- publicar su propio contenido. Se impone en la base y no solo en la capa
    -- de aplicación, porque es el invariante central del flujo editorial.
    CONSTRAINT article_versions_approver_differs_from_author
        CHECK (approved_by IS NULL OR approved_by <> created_by),

    -- Una versión publicada exige aprobador y marca temporal de publicación.
    CONSTRAINT article_versions_published_requires_approval
        CHECK (state <> 'publicado'
            OR (approved_by IS NOT NULL AND published_at IS NOT NULL))
);

ALTER TABLE articles
    ADD CONSTRAINT articles_current_version_fk
    FOREIGN KEY (current_version_id) REFERENCES article_versions (id) ON DELETE SET NULL;

-- Catálogo público: solo versiones publicadas, agrupadas por categoría.
CREATE INDEX article_versions_published_idx
    ON article_versions (article_id) WHERE state = 'publicado';

-- Bandeja de revisión del coordinador editorial.
CREATE INDEX article_versions_in_review_idx
    ON article_versions (created_at) WHERE state = 'en_revision';

CREATE INDEX articles_category_idx ON articles (category);

-- ── quizzes (FR-009: ≥ 1 cuestionario por artículo) ────────────────────────
CREATE TABLE quizzes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id     UUID          NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
    title          TEXT          NOT NULL,
    pass_threshold NUMERIC(6, 2) NOT NULL,                  -- Principio VIII
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT quizzes_pass_threshold_range CHECK (pass_threshold >= 0)
);

CREATE INDEX quizzes_article_idx ON quizzes (article_id);

-- ── questions ──────────────────────────────────────────────────────────────
CREATE TABLE questions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id     UUID          NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
    prompt      TEXT          NOT NULL,
    options     JSONB         NOT NULL,                     -- {clave: enunciado}
    correct_key TEXT          NOT NULL,
    weight      NUMERIC(6, 2) NOT NULL,                     -- Principio VIII
    position    INTEGER       NOT NULL DEFAULT 1,

    UNIQUE (quiz_id, position),
    CONSTRAINT questions_weight_positive CHECK (weight > 0),
    -- La clave correcta debe existir entre las opciones ofrecidas.
    CONSTRAINT questions_correct_key_in_options CHECK (options ? correct_key)
);

CREATE INDEX questions_quiz_idx ON questions (quiz_id, position);

-- ── quiz_attempts (FR-012 / FR-016: historial COMPLETO) ────────────────────
-- Se persiste TODO intento, incluso por debajo del mejor histórico. Reintentos
-- ilimitados (FR-014). El progreso lo deriva Usuarios, no Aprendizaje.
CREATE TABLE quiz_attempts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID          NOT NULL,                      -- ID opaco de Usuarios
    quiz_id    UUID          NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
    attempt_no INTEGER       NOT NULL,
    score      NUMERIC(6, 2) NOT NULL,                      -- Principio VIII
    answers    JSONB         NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),

    UNIQUE (user_id, quiz_id, attempt_no),
    CONSTRAINT quiz_attempts_attempt_no_positive CHECK (attempt_no > 0),
    CONSTRAINT quiz_attempts_score_non_negative CHECK (score >= 0)
);

-- Historial por usuario (ListAttempts) y cálculo del siguiente attempt_no.
CREATE INDEX quiz_attempts_user_quiz_idx
    ON quiz_attempts (user_id, quiz_id, attempt_no DESC);

-- ── article_stats (FR-018 a nivel de contenido) ────────────────────────────
CREATE TABLE article_stats (
    article_id    UUID PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
    view_count    BIGINT        NOT NULL DEFAULT 0,
    attempt_count BIGINT        NOT NULL DEFAULT 0,
    avg_score     NUMERIC(6, 2) NOT NULL DEFAULT 0,         -- Principio VIII

    CONSTRAINT article_stats_counts_non_negative
        CHECK (view_count >= 0 AND attempt_count >= 0)
);

COMMIT;
