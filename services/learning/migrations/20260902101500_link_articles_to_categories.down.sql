-- Revierte 20260902101500_link_articles_to_categories.
--
-- Devuelve articles al estado de texto libre previo, rellenando `category` con
-- el nombre visible de la categoría. Las categorías creadas (incluidas las de
-- completado a cinco) las elimina la migración descendente de 20260902100000;
-- esta solo deshace el vínculo.
BEGIN;

ALTER TABLE articles ADD COLUMN category TEXT;

UPDATE articles a
SET category = c.name
FROM categories c
WHERE c.id = a.category_id;

ALTER TABLE articles ALTER COLUMN category SET NOT NULL;

ALTER TABLE articles DROP CONSTRAINT articles_category_fk;
ALTER TABLE articles DROP COLUMN category_id;

DROP INDEX IF EXISTS articles_category_idx;
CREATE INDEX articles_category_idx ON articles (category);

COMMIT;
