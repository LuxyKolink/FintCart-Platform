-- Servicio de Aprendizaje — `article_versions.body` deja de existir (T135, D-14, FR-063).
--
-- Desde T016 y T124 (`body_doc`) y T145 (el cierre de huecos), el cuerpo del artículo se
-- escribe, se valida y se lee como documento de bloques. `body` sobrevivió hasta aquí por
-- una razón de orden, no de diseño: era la fuente de verdad mientras la conversión no
-- estuviera verificada, y verificado el resultado se elimina. Esta migración es el final
-- del camino que D-14 describió desde el principio.
--
-- Lo que cambia, en tres cosas que van juntas y por eso van en la misma transacción:
--
--   1. `body_doc` pasa a `NOT NULL`. Es la única fuente, así que no admite huecos.
--   2. El CHECK de la raíz pierde su rama `IS NULL`: admitía el nulo porque el nulo era
--      posible, y desde aquí ya no lo es. Un CHECK que permite un estado que la columna
--      prohíbe es una mentira pequeña que se lee como una invitación.
--   3. `body` se elimina.
--
-- **La guarda del paso 0 es lo que hace que el borrado sea honrado**: compara, para cada
-- versión, el texto de `body` con el texto que se DERIVARÁ del documento a partir de
-- ahora, y aborta si alguno discrepa. Después del borrado no hay forma de recuperar el
-- texto original —la reversión reconstruye un texto equivalente, no el mismo— así que la
-- única manera de borrar sin arriesgar contenido es demostrar antes que el texto que se
-- borra es el que el documento ya dice. Se compara **sin espacios**, como en T016: la
-- línea en blanco y los espacios de los extremos son separadores, no contenido.
--
-- El recorrido es un CTE recursivo y NO `jsonb_path_query(doc, '$.**.texto')`, que es lo
-- primero que uno escribe: **`$.**` devuelve cada nodo de texto DOS veces** —una por la
-- rama que lo alcanza como descendiente directo y otra como descendiente del descendiente—
-- de modo que la comparación fallaba sobre documentos correctos y la migración se negaba a
-- borrar datos que estaban bien. Se vio al probarla, y la prueba está en
-- `test/migrations/drop-body.spec.ts`: es el mismo tipo de trampa que un `LIKE` sin anclas.
-- El recorrido explícito, además, hace visible el orden: la `ruta` (los índices desde la
-- raíz) ordena los nodos como los ordena el documento, que es lo que hace `textoDe` en
-- `src/articles/plain-text.ts` al concatenarlos. La imagen y la calculadora no aportan
-- texto en ninguno de los dos lados, y por eso no aparecen.

BEGIN;

DO $$
DECLARE
    discrepancias bigint;
    ejemplo       text;
BEGIN
    IF EXISTS (SELECT 1 FROM article_versions WHERE body_doc IS NULL) THEN
        RAISE EXCEPTION
            'article_versions.body_doc: % versión(es) sin documento; borrar `body` las dejaría sin cuerpo',
            (SELECT count(*) FROM article_versions WHERE body_doc IS NULL);
    END IF;

    SELECT count(*), min(v.id::text) INTO discrepancias, ejemplo
      FROM article_versions v
      LEFT JOIN (
          -- Todos los nodos del documento con su ruta de índices desde la raíz. La ruta
          -- sirve para dos cosas: recorrer el árbol sin repetirse, y ORDENAR los textos
          -- como los ordena el documento cuando se concatenan.
          WITH RECURSIVE nodos AS (
              SELECT v2.id AS articulo, ARRAY[]::bigint[] AS ruta, v2.body_doc AS nodo
                FROM article_versions v2
              UNION ALL
              SELECT n.articulo, n.ruta || e.ord, e.valor
                FROM nodos n
                CROSS JOIN LATERAL jsonb_array_elements(n.nodo->'contenido')
                     WITH ORDINALITY AS e(valor, ord)
               WHERE jsonb_typeof(n.nodo->'contenido') = 'array'
          )
          SELECT c.articulo AS id, string_agg(c.nodo->>'texto', '' ORDER BY c.ruta) AS texto
            FROM nodos c
           WHERE c.nodo->>'tipo' = 'texto'
           GROUP BY c.articulo
      ) derivado ON derivado.id = v.id
     WHERE regexp_replace(v.body, '\s', '', 'g')
        <> regexp_replace(coalesce(derivado.texto, ''), '\s', '', 'g');

    IF discrepancias > 0 THEN
        RAISE EXCEPTION
            'article_versions: % de % versión(es) tienen texto en `body` que el documento NO dice (p. ej. %). '
            'Borrar `body` perdería ese texto, y la reversión NO lo traería de vuelta: reconstruye desde el documento',
            discrepancias, (SELECT count(*) FROM article_versions), ejemplo;
    END IF;

    RAISE NOTICE 'article_versions.body: % versión(es) con el texto que su documento dice, 0 discrepancias',
        (SELECT count(*) FROM article_versions);
END
$$;

ALTER TABLE article_versions ALTER COLUMN body_doc SET NOT NULL;

ALTER TABLE article_versions DROP CONSTRAINT article_versions_body_doc_root;
ALTER TABLE article_versions ADD CONSTRAINT article_versions_body_doc_root
    CHECK (
        jsonb_typeof(body_doc) = 'object'
        AND body_doc->>'tipo' = 'doc'
        AND jsonb_typeof(body_doc->'contenido') = 'array'
    );

ALTER TABLE article_versions DROP COLUMN body;

COMMIT;
