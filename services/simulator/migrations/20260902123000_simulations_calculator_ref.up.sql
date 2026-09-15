-- Una simulación pasa a explicarse por la VERSIÓN EXACTA de la definición que la
-- produjo (FR-050) y por el snapshot de indicadores que usó (FR-058, SC-019).
--
-- `calc_type` se conserva: no invalida el historial existente y mantiene
-- identificables las siete semillas por su tipo original.

BEGIN;

ALTER TABLE simulations ADD COLUMN calculator_id UUID REFERENCES calculators (id);

ALTER TABLE simulations ADD COLUMN calculator_version INTEGER;

ALTER TABLE simulations
    ADD COLUMN indicators_snapshot JSONB NOT NULL DEFAULT '{}';

-- ── Relleno del historial anterior ─────────────────────────────────────────
-- Se empareja por NOMBRE de la definición semilla, no por identificador: los
-- identificadores de las semillas los fija `dev/seed`, y las migraciones corren
-- ANTES que el sembrado (`dev/build → dev/up → dev/migrate → dev/seed`, Principio XII).
-- Sobre una base ya sembrada el relleno actúa; sobre una recién migrada no encuentra
-- nada y deja las filas en NULL, que es la verdad —no había semilla que citar cuando
-- se migró—. `dev/seed` repite este mismo UPDATE tras sembrar, así que el resultado
-- final es el mismo en los dos órdenes.
--
-- `colombia_especifica` NO se puede emparejar por `calc_type`: era UNA calculadora con
-- un discriminador de texto que D-16 separa en tres. Cuál de las tres fue cada fila lo
-- dice su propia entrada `operacion`, que es justo el dato que se conserva en `inputs`.
UPDATE simulations s
SET calculator_id      = c.id,
    calculator_version = c.version
FROM calculators c
WHERE s.calculator_id IS NULL
  AND c.is_builtin
  AND c.name = CASE s.calc_type
                   WHEN 'colombia_especifica' THEN s.inputs ->> 'operacion'
                   ELSE s.calc_type
               END;

-- ── Guardias ───────────────────────────────────────────────────────────────
-- Una versión sin calculadora no se puede interpretar: o se sabe de qué definición
-- salió, o no hay versión que citar.
ALTER TABLE simulations
    ADD CONSTRAINT simulations_calculator_version_requires_id
        CHECK (calculator_version IS NULL OR calculator_id IS NOT NULL);

ALTER TABLE simulations
    ADD CONSTRAINT simulations_calculator_version_positive
        CHECK (calculator_version IS NULL OR calculator_version >= 1);

-- Principio VIII: el snapshot son valores de indicador, así que van como string
-- decimal igual que `inputs` y `result`. La guardia es la MISMA función que ya usan
-- esas dos columnas, no una copia.
ALTER TABLE simulations
    ADD CONSTRAINT simulations_indicators_snapshot_is_object
        CHECK (jsonb_typeof(indicators_snapshot) = 'object');

ALTER TABLE simulations
    ADD CONSTRAINT simulations_indicators_snapshot_no_json_numbers
        CHECK (jsonb_has_no_numbers(indicators_snapshot));

-- FR-058: «qué simulaciones usaron la definición X» se pregunta por aquí.
CREATE INDEX simulations_calculator_idx
    ON simulations (calculator_id) WHERE calculator_id IS NOT NULL;

COMMIT;
