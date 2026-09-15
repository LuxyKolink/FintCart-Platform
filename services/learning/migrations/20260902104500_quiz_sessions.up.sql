-- Servicio de Aprendizaje — sesión de intento de cuestionario (learning_db).
--
-- FR-038…FR-042, D-17. La sesión es estado de dominio de Aprendizaje y vive en su
-- base: el Principio IV prohíbe Redis para cualquier cosa que no sea la blacklist de
-- JWT o el rate limiting, y un almacén de sesiones de negocio está fuera de ambos.
-- Tampoco puede vivir en el cliente: si el navegador declarara qué preguntas le
-- sirvieron, FR-040 sería incumplible, porque el propio cliente elegiría a qué
-- responde (research D-17).
--
-- `served` guarda el orden de preguntas Y el orden de opciones servido
-- (`[{question_id, option_keys[]}]`): FR-038 baraja las alternativas, y sin ese
-- orden la reconstrucción de lo que el usuario vio sería imposible.

BEGIN;

CREATE TABLE quiz_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL,                       -- ID opaco de Usuarios
    quiz_id     UUID        NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
    served      JSONB       NOT NULL,                       -- [{question_id, option_keys[]}]
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,                       -- created_at + 60 min (D-17)
    consumed_at TIMESTAMPTZ,                                -- nulo hasta calificar; impide reusar

    CONSTRAINT quiz_sessions_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT quiz_sessions_served_not_empty CHECK (jsonb_array_length(served) > 0)
);

-- Últimas sesiones de un usuario por cuestionario.
CREATE INDEX quiz_sessions_user_quiz_idx
    ON quiz_sessions (user_id, quiz_id, created_at DESC);

-- Barrido de vencidas (T071): solo las no consumidas.
CREATE INDEX quiz_sessions_expiry_idx
    ON quiz_sessions (expires_at) WHERE consumed_at IS NULL;

COMMIT;
