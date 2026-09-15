-- Servicio de Aprendizaje — intento ligado a su sesión (learning_db).
--
-- FR-039: cada intento conserva un `served_snapshot` de lo servido, y la FK a la
-- sesión queda como `SET NULL` porque las sesiones se purgan al vencer: el historial
-- debe seguir siendo reconstruible años después (FR-016).
--
-- FR-041: `score` pasa a interpretarse como PORCENTAJE sobre 100. El CHECK del rango
-- 0–100 sustituye al anterior, que solo exigía `>= 0`.
--
-- NOTA (D-18 corregida): el código de 001 YA calculaba `score` como porcentaje
-- (`earned/total × 100`), así que NO se reescala `score := 100 × score / Σ weight`
-- como prescribe el plan original — doblaría una nota ya porcentual. Solo se acota
-- el rango. La salvedad de D-18 que SÍ persiste es la del `served_snapshot`: se
-- rellena con las preguntas ACTUALES del cuestionario, que es exactamente lo que se
-- servía antes de esta enmienda; si el banco cambió tras el intento, el conjunto
-- histórico real difiere del registrado y no hay forma de reconstruirlo, porque el
-- peso servido histórico no se registró cuando no existía el concepto.

BEGIN;

ALTER TABLE quiz_attempts
    ADD COLUMN session_id UUID REFERENCES quiz_sessions (id) ON DELETE SET NULL,
    ADD COLUMN served_snapshot JSONB;

-- Pobla `served_snapshot` con TODAS las preguntas del cuestionario en el orden en
-- que se servían antes de esta enmienda (por `position`, opciones ordenadas por
-- clave — el mismo orden estable de `quizzes.repository.ts::toQuestion`).
UPDATE quiz_attempts a
   SET served_snapshot = (
     SELECT jsonb_agg(
              jsonb_build_object(
                'question_id', q.id,
                'option_keys', (SELECT jsonb_agg(opt.key ORDER BY opt.key)
                                  FROM jsonb_object_keys(q.options) AS opt(key))
              )
              ORDER BY q.position
            )
       FROM questions q
      WHERE q.quiz_id = a.quiz_id
   );

-- `served_snapshot` no puede quedar nulo: un intento sin lo que se sirvió no es
-- reconstruible. Si algún cuestionario no tuviera preguntas —imposible por
-- `questions_weight_positive` y por la validación de `UpsertQuiz`—, `jsonb_agg`
-- devolvería NULL y esta restricción fallaría la migración en vez de inventar un
-- snapshot vacío.
ALTER TABLE quiz_attempts
    ALTER COLUMN served_snapshot SET NOT NULL;

ALTER TABLE quiz_attempts
    DROP CONSTRAINT quiz_attempts_score_non_negative,
    ADD CONSTRAINT quiz_attempts_score_range CHECK (score >= 0 AND score <= 100);

COMMIT;
