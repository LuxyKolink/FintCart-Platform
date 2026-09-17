-- Servicio de Aprendizaje — `article_versions.body_doc` (FR-063, FR-069, research D-14).
--
-- El cuerpo deja de ser texto plano y pasa a ser un **documento de bloques** en
-- JSONB con vocabulario cerrado. Esta migración SOLO añade y rellena: `body`
-- sigue ahí y sigue siendo la fuente de verdad hasta que T135 lo elimine, ya
-- verificado el resultado. Ese orden es la razón de que FR-069 pueda afirmar
-- «sin pérdida» y de que la reversión sea trivial.
--
-- Estructura sembrada (D-14):
--   {"tipo":"doc","contenido":[{"tipo":"parrafo","contenido":[{"tipo":"texto","texto":<línea>}]}, …]}
--
-- El texto plano existente se parte por **líneas en blanco**: un párrafo es lo
-- que queda entre dos. Los espacios de los extremos de cada párrafo y los saltos
-- de línea internos se conservan como texto del nodo, y las líneas en blanco
-- separadoras desaparecen — son separadores, no contenido. Por eso la guarda del
-- final compara el texto **sin espacios**: lo que no puede perderse es el texto,
-- no el blanco. Una guarda que exigiera igualdad exacta obligaría a inventar
-- párrafos vacíos para representar un separador, que es lo contrario de lo que
-- el documento de bloques quiere decir.
--
-- `body_doc` nace **anulable**, y no por comodidad: el escritor todavía no lo
-- rellena. Quien crea versiones hoy es
-- `services/learning/src/publishing/publishing.repository.ts`, cuyo INSERT nombra
-- cinco columnas (`id, article_id, version_no, body, created_by`) y ninguna de
-- ellas es `body_doc`. Con `NOT NULL` aquí, **crear un borrador empezaría a fallar
-- en el momento de aplicar esta migración** — comprobado: la primera versión de un
-- artículo nuevo no se podría insertar. El `NOT NULL` llega con T124 (persistir y
-- devolver `body_doc`) y se cierra en T135, cuando `body` desaparezca: en ese
-- momento la columna será la única fuente y no admitirá nulos. Adelantarlo hoy
-- sería exigir un dato que nadie escribe.

BEGIN;

ALTER TABLE article_versions ADD COLUMN body_doc JSONB;

-- 1) Todo documento nace vacío y bien formado. Se hace primero para que las
--    versiones sin texto no dependan del orden del relleno.
UPDATE article_versions SET body_doc = '{"tipo":"doc","contenido":[]}'::jsonb;

-- 2) Los párrafos del texto existente, en su orden.
--
--    `regexp_replace(replace(body, E'\r\n', E'\n'), E'\n[ \t]*\n+', E'\n\n', 'g')`
--    normaliza primero los finales de línea de Windows y colapsa cualquier
--    secuencia de líneas en blanco (con espacios o tabulaciones dentro) a un
--    único separador. Sin esa normalización, un cuerpo con tres saltos seguidos
--    produciría párrafos vacíos intercalados.
UPDATE article_versions v
SET body_doc = jsonb_build_object(
        'tipo', 'doc',
        'contenido', p.contenido
    )
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
            regexp_replace(
                replace(av.body, E'\r\n', E'\n'),
                E'\n[ \t]*\n+', E'\n\n', 'g'
            ),
            E'\n\n'
        )
    ) WITH ORDINALITY AS t(part, ord)
    WHERE btrim(part) <> ''
    GROUP BY av.id
) p
WHERE v.id = p.id;

-- 3) Restringir. La forma de la raíz se impone en la base y no solo en el
--    validador de la aplicación: un documento sin raíz `doc` no es un documento,
--    y un CHECK aquí evita que una escritura futura por fuera del validador
--    meta basura que ningún lector sabría interpretar.
ALTER TABLE article_versions ADD CONSTRAINT article_versions_body_doc_root
    CHECK (
        body_doc IS NULL
        OR (
            jsonb_typeof(body_doc) = 'object'
            AND body_doc->>'tipo' = 'doc'
            AND jsonb_typeof(body_doc->'contenido') = 'array'
        )
    );

-- 4) Guarda de la conversión: ninguna versión puede perder texto.
DO $$
DECLARE
    total     bigint;
    parrafos  bigint;
    perdidas  bigint;
BEGIN
    SELECT count(*),
           coalesce(sum(jsonb_array_length(body_doc->'contenido')), 0)
      INTO total, parrafos
      FROM article_versions;

    -- El relleno no puede dejar ninguna fila atrás: si alguna quedara nula, la
    -- conversión no estaría hecha y el `NOT NULL` de T135 fallaría sin explicar
    -- por qué.
    IF EXISTS (SELECT 1 FROM article_versions WHERE body_doc IS NULL) THEN
        RAISE EXCEPTION
            'article_versions.body_doc: % versión(es) sin convertir',
            (SELECT count(*) FROM article_versions WHERE body_doc IS NULL);
    END IF;

    SELECT count(*) INTO perdidas
      FROM article_versions v
      CROSS JOIN LATERAL (
          SELECT coalesce(
                     string_agg(elem->'contenido'->0->>'texto', '' ORDER BY ord),
                     ''
                 ) AS texto
            FROM jsonb_array_elements(v.body_doc->'contenido')
                 WITH ORDINALITY AS e(elem, ord)
      ) t
     WHERE regexp_replace(v.body, '\s', '', 'g')
        <> regexp_replace(t.texto, '\s', '', 'g');

    IF perdidas > 0 THEN
        RAISE EXCEPTION
            'article_versions.body_doc: % de % versión(es) perdieron texto al convertirse',
            perdidas, total;
    END IF;

    RAISE NOTICE
        'article_versions.body_doc: % versión(es) convertidas, % párrafos, 0 pérdidas de texto',
        total, parrafos;
END
$$;

COMMIT;
