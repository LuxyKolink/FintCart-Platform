-- Servicio de Aprendizaje — catálogo administrable de categorías (learning_db).
--
-- FR-032…FR-036: articles.category (texto libre) pasa a referenciar esta tabla.
-- Aquí solo se crea la estructura; la conversión de datos vive en la migración
-- emparejada siguiente (20260902101500_link_articles_to_categories).
--
-- D-19: las filas NUNCA se borran físicamente. Un artículo archivado cuya categoría
-- desapareciera dejaría de ser reconstruible (FR-013); la desactivación es lógica
-- vía `active`.

BEGIN;

CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    position    INTEGER     NOT NULL,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT categories_name_not_blank CHECK (length(btrim(name)) > 0),
    -- Identificador legible para rutas y filtros (data-model §1.1).
    CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT categories_slug_key UNIQUE (slug)
);

-- Un nombre solo puede reutilizarse si la categoría homónima está desactivada.
CREATE UNIQUE INDEX categories_name_active_uniq
    ON categories (lower(name)) WHERE active;

-- `position` ordena el desplegable del editor y el catálogo público.
CREATE UNIQUE INDEX categories_position_active_uniq
    ON categories (position) WHERE active;

COMMIT;
