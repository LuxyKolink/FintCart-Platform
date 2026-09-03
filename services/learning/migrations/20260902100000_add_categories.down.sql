-- Revierte 20260902100000_add_categories. La FK articles → categories ya fue
-- retirada por la migración anterior en el flujo descendente, así que no hay
-- dependencias que impidan eliminar la tabla.
BEGIN;

DROP TABLE IF EXISTS categories;

COMMIT;
