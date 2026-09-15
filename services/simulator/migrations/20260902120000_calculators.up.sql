-- Constructor de calculadoras (FR-043…FR-054, research D-15).
--
-- Dos tablas y no una: `calculators` es la IDENTIDAD (autoría, estado de curaduría,
-- versión vigente) y `calculator_definitions` es la HISTORIA de definiciones. Una
-- definición nunca se actualiza — editar produce una fila nueva —, que es lo que
-- permite que `simulations` referencie la versión EXACTA con la que calculó (FR-050)
-- y que una calculadora publicada siga sirviendo su versión aprobada mientras el
-- autor edita la siguiente (FR-052).

BEGIN;

-- `gen_random_uuid()` es función del núcleo desde PostgreSQL 13 (el objetivo es 16),
-- así que no hace falta declarar pgcrypto aquí: la migración inicial ya lo hizo para
-- esta base y su `down` lo deja a propósito.

CREATE TABLE calculators (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id         UUID,                          -- nulo en las siete semillas (D-16)
    name             TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
    description      TEXT        NOT NULL DEFAULT '',
    is_builtin       BOOLEAN     NOT NULL DEFAULT FALSE,
    state            TEXT        NOT NULL DEFAULT 'privada',
    approved_by      UUID,                          -- nulo hasta aprobar (FR-053)
    rejection_reason TEXT,                          -- FR-054
    version          INTEGER     NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT calculators_state_valid
        CHECK (state IN ('privada', 'en_revision', 'publicada')),

    CONSTRAINT calculators_version_positive CHECK (version >= 1),

    -- FR-053 impuesto en la BASE y no solo en la aplicación: nadie aprueba lo suyo,
    -- ni siquiera por una carrera entre dos peticiones.
    CONSTRAINT calculators_approver_differs_from_owner
        CHECK (approved_by IS NULL OR owner_id IS NULL OR approved_by <> owner_id),

    -- Las semillas están publicadas sin aprobador porque no tienen autor.
    CONSTRAINT calculators_published_requires_approval
        CHECK (state <> 'publicada' OR is_builtin OR approved_by IS NOT NULL),

    -- IMPLICACIÓN, no equivalencia. Ser semilla implica no tener autor, pero NO al
    -- revés: una calculadora publicada cuyo autor se anonimizó (FR-077, Edge Cases)
    -- también queda con `owner_id` nulo sin volverse semilla. Una equivalencia
    -- estricta —`is_builtin = (owner_id IS NULL)`— haría FALLAR la anonimización.
    CONSTRAINT calculators_builtin_has_no_owner
        CHECK (NOT is_builtin OR owner_id IS NULL)
);

-- FR-051: `owner_id` lista las propias. Parcial porque las semillas y las
-- calculadoras anonimizadas no tienen autor que las liste.
CREATE INDEX calculators_owner_idx
    ON calculators (owner_id) WHERE owner_id IS NOT NULL;

-- FR-051: el catálogo público.
CREATE INDEX calculators_published_idx
    ON calculators (name) WHERE state = 'publicada';

CREATE TABLE calculator_definitions (
    calculator_id  UUID        NOT NULL REFERENCES calculators (id) ON DELETE CASCADE,
    version        INTEGER     NOT NULL,
    inputs         JSONB       NOT NULL,                  -- [{clave,etiqueta,tipo,unidad,min,max,default,requerido}]
    validations    JSONB       NOT NULL DEFAULT '[]',     -- [{ast,mensaje}]
    outputs        JSONB       NOT NULL,                  -- [{clave,etiqueta,ast,escala,cuando?}]
    indicators_used TEXT[]     NOT NULL DEFAULT '{}',     -- extraído del AST al guardar (FR-057)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Una fila por versión: la clave compuesta es lo que hace imposible sobrescribir
    -- una definición ya usada por una simulación.
    PRIMARY KEY (calculator_id, version),

    CONSTRAINT calculator_definitions_version_positive CHECK (version >= 1),

    -- FR-046: los topes que el propio autor puede contar. Los de nodos y profundidad
    -- del AST (≤ 64 / ≤ 16) NO están aquí a propósito: recorrer un árbol para contar
    -- nodos en un CHECK sería ilegible y se desincronizaría del analizador real.
    -- Todo `ast` persistido ya pasó por el analizador del Simulador (data-model.md §2.2).
    CONSTRAINT calculator_definitions_inputs_bounded
        CHECK (jsonb_array_length(inputs) BETWEEN 1 AND 20),
    CONSTRAINT calculator_definitions_outputs_bounded
        CHECK (jsonb_array_length(outputs) BETWEEN 1 AND 10),

    -- `jsonb_array_length` no devuelve NULL ante un no-array: ERROR. Estos dos CHECK
    -- existen para que el fallo diga QUÉ está mal en vez de reventar con un error de
    -- función, que es lo que pasaría si solo estuvieran los `_bounded` de arriba.
    CONSTRAINT calculator_definitions_inputs_is_array
        CHECK (jsonb_typeof(inputs) = 'array'),
    CONSTRAINT calculator_definitions_validations_is_array
        CHECK (jsonb_typeof(validations) = 'array'),
    CONSTRAINT calculator_definitions_outputs_is_array
        CHECK (jsonb_typeof(outputs) = 'array')
);

-- NOTA DELIBERADA — por qué NO se aplica aquí `jsonb_has_no_numbers`, la guardia del
-- Principio VIII que sí llevan `simulations.inputs/result`:
--
-- `outputs` contiene `escala`, que es un RECUENTO de decimales de redondeo, no una
-- cifra monetaria. La guardia rechaza CUALQUIER número JSON a cualquier profundidad,
-- así que aplicarla aquí rechazaría definiciones perfectamente válidas. El Principio
-- VIII rige montos, tasas y valores de indicador; los literales decimales del AST van
-- como string por construcción del analizador (research D-15), y eso lo vigila el
-- análisis estático del motor (T158), no el esquema.

COMMIT;
