-- Servicio de Aprendizaje — cierra el hueco de `body_doc` que quedó entre T016 y T124.
--
-- T016 convirtió las versiones que existían en ese momento (79, contadas contra la base
-- real) y T124 hizo que el camino de escritura rellenara el documento en toda versión
-- NUEVA. Entre las dos quedan las versiones creadas en medio —las que hicieron las
-- pruebas de extremo a extremo mientras el camino de escritura todavía no sabía nada de
-- la columna— y son las únicas filas que hoy tienen `body` y no tienen documento.
--
-- Se cierra ahora y no en T135 por una razón concreta: T135 tiene que imponer `NOT NULL`
-- y borrar `body`. Si se llega allí con filas a medias, esa migración falla —o, peor, si
-- alguien la escribe con un `COALESCE` defensivo, deja documentos vacíos que parecen
-- contenido válido—. Restaurar el invariante («toda versión con texto tiene documento»)
-- es un paso propio, con su propia guarda, y así T135 puede ser lo que dice ser.
--
-- La regla de conversión es la MISMA que la de `20260902111500` y que la de
-- `src/articles/plain-text.ts`. Está escrita tres veces porque los tres sitios no pueden
-- compartir código: dos son SQL ejecutado una vez por `golang-migrate` y uno es TypeScript
-- del servicio. Lo que evita que se separen son las pruebas que fijan la misma entrada en
-- cada lado, no la buena intención.
BEGIN;

UPDATE article_versions v
SET body_doc = jsonb_build_object('tipo', 'doc', 'contenido', p.contenido)
FROM (
    SELECT av.id,
           jsonb_agg(
               jsonb_build_object(
                   'tipo', 'parrafo',
                   'contenido', jsonb_build_array(
                       jsonb_build_object('tipo', 'texto', 'texto', btrim(part))
                   )
               ) ORDER BY ord
           ) AS contenido
    FROM article_versions av
    CROSS JOIN LATERAL unnest(
        regexp_split_to_array(
            regexp_replace(replace(av.body, E'\r\n', E'\n'), E'\n[ \t]*\n+', E'\n\n', 'g'),
            E'\n\n'
        )
    ) WITH ORDINALITY AS t(part, ord)
    WHERE av.body_doc IS NULL AND btrim(part) <> ''
    GROUP BY av.id
) p
WHERE v.id = p.id;

-- Las que tengan `body` vacío no aparecen arriba (no producen párrafos): se les da el
-- documento vacío, que es una respuesta y no un hueco.
UPDATE article_versions
   SET body_doc = '{"tipo":"doc","contenido":[]}'::jsonb
 WHERE body_doc IS NULL;

DO $$
DECLARE
    pendientes bigint;
BEGIN
    SELECT count(*) INTO pendientes FROM article_versions WHERE body_doc IS NULL;
    IF pendientes > 0 THEN
        RAISE EXCEPTION 'body_doc: % versión(es) siguen sin documento', pendientes;
    END IF;
    RAISE NOTICE 'body_doc: % versiones con documento, 0 sin documento',
        (SELECT count(*) FROM article_versions);
END
$$;

COMMIT;
