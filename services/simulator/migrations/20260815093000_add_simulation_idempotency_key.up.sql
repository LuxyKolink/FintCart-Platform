-- Clave de idempotencia de `Compute` (T176, SC-008).
--
-- El motor de sagas del Orquestador reintenta un paso cuando su avance no llegó a
-- confirmarse, aunque la llamada al participante ya haya surtido efecto
-- (`saga.go::run`, comentario junto a `advance`: "de ahí que Do deba ser
-- idempotente"). Antes de esta columna, `simulator.compute` no tenía forma de
-- reconocer ese reintento: cada llamada insertaba una fila nueva, así que una
-- caída justo entre el `Compute` que tuvo éxito y el registro del avance dejaba
-- DOS simulaciones por una sola acción del usuario — inflando el historial
-- (FR-022) y el contador `simulations_run` de `GetActivityReport` (N-02).
--
-- `idempotency_key` es NULLABLE a propósito: un cliente directo del RPC (fuera de
-- una saga) puede no tener una clave estable que ofrecer, y en ese caso cada
-- llamada sigue insertando una fila nueva, como antes. El índice único NO es
-- parcial: un `UNIQUE` estándar ya no considera dos `NULL` iguales entre sí (así lo
-- exige el estándar SQL, y Postgres lo respeta), así que el caso sin clave convive
-- sin imponerle unicidad de todos modos — sin necesitar `WHERE idempotency_key IS
-- NOT NULL`. Un índice completo es más simple y exactamente igual de correcto; de
-- paso, la migración equivalente de Aprendizaje (`quiz_attempts`, misma T176) hace
-- lo mismo por una razón adicional propia de ese servicio: su doble de pruebas
-- (`pg-mem`) no soporta `ON CONFLICT (col) WHERE ... DO NOTHING`.
ALTER TABLE simulations
    ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX simulations_idempotency_key_unique
    ON simulations (idempotency_key);

COMMENT ON COLUMN simulations.idempotency_key IS
    'T176: clave estable que el Orquestador deriva del saga_id del paso simulator.compute. Repetir la misma clave devuelve la fila existente en vez de duplicar el historial ante un reintento de saga.';
