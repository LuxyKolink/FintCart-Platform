-- Servicio de Aprendizaje — articles.category (texto libre) → categories.id (FR-034).
--
-- Migración de conversión de datos (D-19), el orden poblar → restringir es la
-- garantía de que ningún artículo queda huérfano (data-model §1.2):
--
--   1. Crear `categories` desde los valores distintos normalizados de
--      articles.category — recorte, colapso de espacios y comparación sin
--      distinguir mayúsculas ni tildes — conservando el original como nombre.
--   2. Completar hasta el mínimo de cinco categorías temáticas (SC-009) si el
--      catálogo real trajera menos.
--   3. Añadir `category_id` anulable y rellenarla por correspondencia con el
--      valor normalizado.
--   4. Solo entonces imponer `NOT NULL` + FK y eliminar `category`.
--
-- Identidad de la categoría = `slug` (único por tabla), derivado de la clave
-- normalizada: los valores históricos que difieren solo en separadores
-- ('seguridad_financiera' vs 'seguridad-financiera' vs 'Seguridad Financiera')
-- colapsan en una sola categoría porque el formato de `slug`
-- ('^[a-z0-9]+(-[a-z0-9]+)*$') no admite subrayados ni espacios.

BEGIN;

-- ── normalización y slug (auxiliares efímeros, se retiran antes de COMMIT) ──
-- Clave de comparación: minúsculas, sin tildes sobre vocales/ñ, espacios
-- colapsados a uno y extremos recortados.
CREATE FUNCTION learning_category_key(raw text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT lower(translate(
        regexp_replace(btrim(raw), '\s+', ' ', 'g'),
        'áéíóúüñÁÉÍÓÚÜÑ',
        'aeiouunAEIOUUN'
    ))
$$;

-- Slug legible a partir de una clave ya normalizada: cada runa que no sea
-- [a-z0-9] se vuelve un guion; se recortan los guiones de los extremos.
CREATE FUNCTION learning_category_slug(key text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT btrim(regexp_replace(key, '[^a-z0-9]+', '-', 'g'), '-')
$$;

-- 1) Categorías desde el contenido existente. `name` conserva un original
--    (el alfabéticamente menor entre los equivalentes); `slug` deriva de la
--    clave, con posición consecutiva por orden de slug.
INSERT INTO categories (name, slug, position)
SELECT min(btrim(a.category))                                  AS name,
       learning_category_slug(learning_category_key(btrim(a.category))) AS slug,
       row_number() OVER (ORDER BY learning_category_slug(
           learning_category_key(btrim(a.category))))::integer AS position
FROM articles a
WHERE length(btrim(a.category)) > 0
GROUP BY learning_category_slug(learning_category_key(btrim(a.category)));

-- 2) Completar hasta cinco categorías temáticas (SC-009). Solo se inserta una
--    categoría canónica si su slug aún no está tomado, y las posiciones se
--    encadenan tras el máximo existente para no chocar con el índice parcial.
INSERT INTO categories (name, slug, position)
SELECT c.name,
       c.slug,
       (base.max_position + row_number() OVER (ORDER BY c.ord))::integer
FROM (VALUES
        (1, 'Presupuesto',            'presupuesto'),
        (2, 'Ahorro',                 'ahorro'),
        (3, 'Crédito',                'credito'),
        (4, 'Inversión',              'inversion'),
        (5, 'Seguridad financiera',   'seguridad-financiera')
     ) AS c(ord, name, slug)
CROSS JOIN (SELECT COALESCE(max(position), 0) AS max_position FROM categories) base
WHERE NOT EXISTS (SELECT 1 FROM categories existing WHERE existing.slug = c.slug);

-- 3) Columna anulable + relleno. La correspondencia es por SLUG, no por nombre
--    normalizado: cuando dos valores legados colapsan en una sola categoría
--    ('seguridad_financiera' y 'Seguridad Financiera' → 'seguridad-financiera'),
--    el nombre superviviente es solo UNO de los originales y el otro valor jamás
--    igualaría su clave. El slug, en cambio, es la identidad de agrupación.
ALTER TABLE articles ADD COLUMN category_id UUID;

UPDATE articles a
SET category_id = c.id
FROM categories c
WHERE c.slug = learning_category_slug(learning_category_key(btrim(a.category)));

-- Guarda explícita: la columna no debe quedar con huérfanos. Imposible por
-- construcción (toda clave distinta generó su categoría), pero un fallo aquí
-- es mejor que un NOT NULL a medias con filas rotas.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM articles WHERE category_id IS NULL) THEN
        RAISE EXCEPTION
            'categories: % artículo(s) sin categoría al imponer NOT NULL',
            (SELECT count(*) FROM articles WHERE category_id IS NULL);
    END IF;
END
$$;

-- 4) Restringir y limpiar el texto libre.
ALTER TABLE articles ALTER COLUMN category_id SET NOT NULL;

ALTER TABLE articles
    ADD CONSTRAINT articles_category_fk
    FOREIGN KEY (category_id) REFERENCES categories (id);

DROP INDEX IF EXISTS articles_category_idx;
ALTER TABLE articles DROP COLUMN category;
CREATE INDEX articles_category_idx ON articles (category_id);

-- Retirar los auxiliares de la transacción.
DROP FUNCTION learning_category_slug(text);
DROP FUNCTION learning_category_key(text);

COMMIT;
