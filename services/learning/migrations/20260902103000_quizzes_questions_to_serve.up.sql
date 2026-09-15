-- Servicio de Aprendizaje — preguntas a servir por intento (learning_db).
--
-- FR-037: cada intento sirve `questions_to_serve` preguntas (por defecto 5); si el
-- banco tiene menos, se sirven todas (FR-038).
--
-- FR-041: `pass_threshold` pasa a interpretarse como PORCENTAJE sobre 100. El CHECK
-- del rango 0–100 sustituye al anterior, que solo exigía `>= 0`.
--
-- NOTA (D-18 corregida): el código de 001 YA guardaba `pass_threshold` como
-- porcentaje sobre 100 (`grading.service.ts::computeScore` devuelve
-- `earned/total × 100`, y el editor del frontend rotula el campo «0–100»). Por eso
-- esta migración NO reescala `pass_threshold := 100 × pass_threshold / Σ weight`
-- como prescribe el plan original: aplicar esa fórmula sobre datos ya porcentuales
-- los doblaría (una nota de 70 con Σ weight = 10 pasaría a 700) y violaría el
-- propio CHECK que aquí se impone. Solo se acota el rango.

BEGIN;

ALTER TABLE quizzes
    ADD COLUMN questions_to_serve INTEGER NOT NULL DEFAULT 5;

ALTER TABLE quizzes
    ADD CONSTRAINT quizzes_questions_to_serve_positive CHECK (questions_to_serve > 0);

ALTER TABLE quizzes
    DROP CONSTRAINT quizzes_pass_threshold_range,
    ADD CONSTRAINT quizzes_pass_threshold_range CHECK (pass_threshold >= 0 AND pass_threshold <= 100);

COMMIT;
