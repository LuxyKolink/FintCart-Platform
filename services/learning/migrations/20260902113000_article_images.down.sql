-- Revierte 20260902113000_article_images.
--
-- La baja es total y sin residuos: la tabla nace aquí y muere aquí, así que no
-- hay nada que devolver a un estado anterior. Se deja escrito porque una
-- reversión que no piensa su alcance es la que deja una tabla huérfana que
-- nadie sabe si puede borrar.
BEGIN;

DROP INDEX IF EXISTS article_images_article_idx;
DROP TABLE IF EXISTS article_images;

COMMIT;
