-- Revierte 20260902103000_quizzes_questions_to_serve.

BEGIN;

ALTER TABLE quizzes
    DROP CONSTRAINT quizzes_pass_threshold_range,
    ADD CONSTRAINT quizzes_pass_threshold_range CHECK (pass_threshold >= 0);

ALTER TABLE quizzes
    DROP CONSTRAINT quizzes_questions_to_serve_positive;

ALTER TABLE quizzes
    DROP COLUMN questions_to_serve;

COMMIT;
