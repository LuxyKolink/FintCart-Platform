-- Clave de idempotencia de `GradeAndStoreAttempt` (T176, SC-008, FR-016).
--
-- El motor de sagas del Orquestador reintenta el paso `learning.grade_and_store_attempt`
-- cuando su avance no llegó a confirmarse, aunque la llamada ya haya guardado el
-- intento (`saga.go::run`, comentario junto a `advance`: "de ahí que Do deba ser
-- idempotente"). `storeAttempt` no tenía forma de reconocer ese reintento: cada
-- llamada calcula `MAX(attempt_no)+1` e inserta sin condición, así que una caída
-- justo entre el `GradeAndStoreAttempt` que tuvo éxito y el registro del avance
-- dejaba un intento FANTASMA en el historial — exactamente lo que FR-016 ("historial
-- completo y ordenado") no puede tolerar, y un segundo `users.apply_quiz_score`
-- espurio de más.
--
-- `idempotency_key` es NULLABLE por la misma razón que en `simulations` (ver la
-- migración equivalente del Simulador): un cliente directo del RPC sin una clave
-- estable que ofrecer sigue insertando un intento por llamada, como antes.
--
-- El índice único NO es parcial: un `UNIQUE` estándar ya no considera dos `NULL`
-- iguales entre sí, así que el caso sin clave convive sin imponerle unicidad de
-- todos modos, sin necesitar `WHERE idempotency_key IS NOT NULL`. Se prefiere así
-- porque `pg-mem` —el doble de PostgreSQL contra el que corre la suite de
-- persistencia (`repositories.spec.ts`, T082)— no soporta `ON CONFLICT (col)
-- WHERE ... DO NOTHING`: con un índice parcial, la sentencia real dejaría de ser
-- ejecutable en el doble, que es justo lo que la convención de este archivo evita
-- (ver la cabecera de `test/support/memdb.ts`).
ALTER TABLE quiz_attempts
    ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX quiz_attempts_idempotency_key_unique
    ON quiz_attempts (idempotency_key);

COMMENT ON COLUMN quiz_attempts.idempotency_key IS
    'T176: clave estable que el Orquestador deriva del saga_id del paso learning.grade_and_store_attempt. Repetir la misma clave devuelve el intento existente en vez de duplicarlo ante un reintento de saga.';
