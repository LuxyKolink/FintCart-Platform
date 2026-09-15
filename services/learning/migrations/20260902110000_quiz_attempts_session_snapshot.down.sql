-- Revierte 20260902110000_quiz_attempts_session_snapshot.

BEGIN;

ALTER TABLE quiz_attempts
    DROP CONSTRAINT quiz_attempts_score_range,
    ADD CONSTRAINT quiz_attempts_score_non_negative CHECK (score >= 0);

-- `DROP COLUMN` retira también la FK a `quiz_sessions` que dependía de la columna.
ALTER TABLE quiz_attempts
    DROP COLUMN served_snapshot,
    DROP COLUMN session_id;

COMMIT;
