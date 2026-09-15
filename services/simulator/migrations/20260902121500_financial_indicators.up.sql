-- Indicadores financieros anuales (FR-055…FR-060, research D-22).
--
-- Un indicador es un valor con VIGENCIA: `@UVT` no vale lo mismo en 2025 que en
-- 2026, y una simulación debe poder explicarse con el valor que regía el día en
-- que se calculó (FR-058). Por eso la vigencia es un `DATERANGE` y no dos columnas
-- sueltas: es lo que permite expresar el solapamiento como una restricción de
-- exclusión en vez de como una consulta que hay que acordarse de hacer.

BEGIN;

-- Requerida por el EXCLUDE de abajo: GiST no sabe comparar TEXT por igualdad por sí
-- solo, y `btree_gist` le aporta esa clase de operador. Sin ella el CREATE TABLE
-- falla, no es una optimización.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE financial_indicators (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT          NOT NULL,
    value         NUMERIC(20, 6) NOT NULL,   -- Principio VIII: nunca float
    validity      DATERANGE     NOT NULL,
    registered_by UUID          NOT NULL,    -- administrador (ID opaco, no PII)
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),

    -- El mismo identificador que las fórmulas referencian como `@NOMBRE`. Se impone
    -- aquí porque un nombre que no case nunca con el del AST sería un indicador
    -- invisible: existiría, pero ninguna fórmula podría referenciarlo.
    CONSTRAINT financial_indicators_name_format
        CHECK (name ~ '^[A-Z][A-Z0-9_]*$'),

    CONSTRAINT financial_indicators_value_non_negative CHECK (value >= 0),

    -- Convención `[inicio, fin)` documentada en data-model.md §2.3. Se impone para
    -- que «qué indicador rige el día D» tenga UNA sola respuesta: con un rango
    -- cerrado por arriba, el día de solape entre dos vigencias consecutivas
    -- pertenecería a ambas y la resolución dependería del orden de lectura.
    CONSTRAINT financial_indicators_validity_half_open
        CHECK (NOT isempty(validity) AND lower_inc(validity) AND NOT upper_inc(validity)),

    -- FR-059, impuesto en la BASE y no solo en la aplicación: dos administradores
    -- cargando el UVT del mismo año a la vez es un caso real, y una comprobación
    -- «leer y luego escribir» en la aplicación no lo detecta. Un rango vacío no
    -- solapa con nada, y de ahí el `NOT isempty` de arriba.
    CONSTRAINT financial_indicators_no_overlap
        EXCLUDE USING gist (name WITH =, validity WITH &&)
);

CREATE INDEX financial_indicators_lookup_idx
    ON financial_indicators (name, validity);

COMMIT;
