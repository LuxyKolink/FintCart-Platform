-- Servicio de Simulador — esquema inicial (simulator_db).
--
-- Principio VIII (NON-NEGOTIABLE): los parámetros y resultados se guardan en
-- JSONB con los montos y tasas como STRING DECIMAL CANÓNICA (research D-10),
-- no como número JSON. Un número JSON se almacenaría como `numeric` dentro del
-- jsonb, pero al deserializarlo en Rust pasaría por f64 en la mayoría de los
-- deserializadores — exactamente lo que el principio prohíbe. En cómputo se usa
-- rust_decimal::Decimal.
--
-- Principio V: el Simulador NO produce eventos (research D-03). La auditoría de
-- una simulación la emite el Orquestador.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Guardia del Principio VIII a nivel de esquema ──────────────────────────
-- Un CHECK de PostgreSQL NO puede contener subconsultas, así que la comprobación
-- vive en una función IMMUTABLE que el CHECK invoca. Recorre el documento en
-- profundidad: un número anidado dentro de un array o de un sub-objeto es tan
-- peligroso como uno en la raíz.
CREATE OR REPLACE FUNCTION jsonb_has_no_numbers(doc JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE jsonb_typeof(doc)
        WHEN 'number' THEN FALSE
        WHEN 'object' THEN COALESCE(
            (SELECT bool_and(jsonb_has_no_numbers(value)) FROM jsonb_each(doc)),
            TRUE)
        WHEN 'array'  THEN COALESCE(
            (SELECT bool_and(jsonb_has_no_numbers(value)) FROM jsonb_array_elements(doc)),
            TRUE)
        ELSE TRUE
    END;
$$;

COMMENT ON FUNCTION jsonb_has_no_numbers(JSONB) IS
    'Principio VIII (NON-NEGOTIABLE): rechaza cualquier número JSON en los payloads de simulación. Todo monto o tasa debe viajar como string decimal canónica para no pasar por f64 al deserializar.';

CREATE TABLE simulations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL,                        -- ID opaco; anonimizable (FR-030)
    calc_type  TEXT        NOT NULL,
    currency   TEXT        NOT NULL DEFAULT 'COP',          -- FR-020
    inputs     JSONB       NOT NULL,                        -- montos/tasas como string decimal
    result     JSONB       NOT NULL,                        -- montos/tasas como string decimal
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- FR-019: las cinco calculadoras del alcance.
    CONSTRAINT simulations_calc_type_valid
        CHECK (calc_type IN ('ahorro', 'credito', 'presupuesto', 'inversion', 'colombia_especifica')),

    CONSTRAINT simulations_currency_iso4217
        CHECK (currency ~ '^[A-Z]{3}$'),

    CONSTRAINT simulations_inputs_is_object
        CHECK (jsonb_typeof(inputs) = 'object'),
    CONSTRAINT simulations_result_is_object
        CHECK (jsonb_typeof(result) = 'object'),

    -- Principio VIII: ningún número JSON crudo, a ninguna profundidad.
    CONSTRAINT simulations_inputs_no_json_numbers
        CHECK (jsonb_has_no_numbers(inputs)),
    CONSTRAINT simulations_result_no_json_numbers
        CHECK (jsonb_has_no_numbers(result))
);

-- FR-022: historial por usuario, más recientes primero.
CREATE INDEX simulations_user_created_idx
    ON simulations (user_id, created_at DESC);

CREATE INDEX simulations_calc_type_idx ON simulations (calc_type);

COMMIT;
