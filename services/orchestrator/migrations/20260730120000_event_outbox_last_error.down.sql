-- Revierte la columna de causa del último fallo de publicación.
--
-- Revertir DESTRUYE el diagnóstico acumulado de los eventos que no se pudieron
-- publicar. No afecta a la entrega —`attempts` y `published_at` siguen intactos—,
-- pero después de bajar esta migración ya no se puede saber por qué falló ninguno
-- de los eventos que quedaron pendientes.

BEGIN;

ALTER TABLE event_outbox DROP COLUMN last_error;

COMMIT;
