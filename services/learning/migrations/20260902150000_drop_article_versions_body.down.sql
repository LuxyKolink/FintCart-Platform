-- Reversión de `20260902150000_drop_article_versions_body`: devuelve `body` a partir del
-- documento.
--
-- **Esta reversión no devuelve el texto original, y no puede.** El `up` borra una columna
-- cuyo contenido, a partir de ese momento, solo existe dentro del documento; reconstruir
-- el texto es derivarlo otra vez. Lo que se recupera es un texto **equivalente**, con dos
-- diferencias que conviene tener escritas:
--
--   1. Los espacios en blanco vuelven normalizados: los espacios de los extremos de cada
--      párrafo y el número de líneas en blanco que separaba dos párrafos son separadores,
--      y la conversión de ida y vuelta de T016 ya los había perdido. El texto sin espacios
--      es el mismo — que es justamente la comparación que hace la guarda del `up`.
--   2. Un bloque estructurado se aplana a líneas: un párrafo y un encabezado son una línea,
--      y **cada elemento de una lista es una línea**, que es la misma unidad que usa el
--      lector del servicio. Un artículo que solo lleva una imagen o una calculadora se
--      queda con el texto vacío, porque ninguno de los dos aporta texto: su cuerpo son sus
--      bloques, no una frase.
--
-- La regla está escrita aquí y no es la misma que la del `up` a propósito: el `up` solo
-- tiene que COMPARAR, y comparar sin espacios le basta. La reversión, en cambio, TIENE que
-- producir texto, y produce el de un lector que no entiende bloques.
--
-- El orden es el inverso al del `up`, y las columnas y restricciones vuelven a admitir el
-- estado que el `up` prohibió: `body_doc` vuelve a ser anulable y `body` vuelve a ser
-- obligatoria. Revertir tiene que dejar la base como estaba, no como a esta migración le
-- hubiera gustado que estuviera.

BEGIN;

ALTER TABLE article_versions ADD COLUMN body TEXT;

UPDATE article_versions v
SET body = coalesce(derivado.texto, '')
FROM (
    -- El recorrido es un CTE recursivo y NO `jsonb_path_query(doc, '$.**.texto')`, que
    -- devuelve cada nodo de texto DOS veces y produciría un texto con todo duplicado. Es la
    -- misma trampa que documenta la guarda del `up`, y aquí se habría visto como un cuerpo
    -- que dice cada párrafo dos veces —un defecto silencioso si no hubiera una prueba que
    -- fijara el texto reconstruido.
    --
    -- `linea` es la ruta del ancestro más cercano que ES una línea (un párrafo, un
    -- encabezado o un elemento de lista), y se arrastra hacia abajo desde que se encuentra:
    -- los nodos de texto de un mismo párrafo comparten clave y por eso se CONCATENAN, y dos
    -- párrafos distintos producen dos claves distintas. Es exactamente la regla de
    -- `lineasDe` en `src/articles/plain-text.ts`, escrita en SQL.
    WITH RECURSIVE nodos AS (
        SELECT v2.id AS articulo, ARRAY[]::bigint[] AS ruta, NULL::bigint[] AS linea, v2.body_doc AS nodo
          FROM article_versions v2
        UNION ALL
        SELECT n.articulo,
               n.ruta || e.ord,
               coalesce(
                   n.linea,
                   CASE WHEN e.valor->>'tipo' IN ('parrafo', 'encabezado', 'item_lista')
                        THEN n.ruta || e.ord END
               ),
               e.valor
          FROM nodos n
          CROSS JOIN LATERAL jsonb_array_elements(n.nodo->'contenido')
               WITH ORDINALITY AS e(valor, ord)
         WHERE jsonb_typeof(n.nodo->'contenido') = 'array'
    ),
    lineas AS (
        SELECT n.articulo,
               coalesce(n.linea, n.ruta) AS clave,
               string_agg(n.nodo->>'texto', '' ORDER BY n.ruta) AS texto
          FROM nodos n
         WHERE n.nodo->>'tipo' = 'texto'
         GROUP BY n.articulo, coalesce(n.linea, n.ruta)
    )
    SELECT l.articulo AS id, string_agg(l.texto, E'\n\n' ORDER BY l.clave) AS texto
      FROM lineas l
     GROUP BY l.articulo
) AS derivado
WHERE v.id = derivado.id;

ALTER TABLE article_versions ALTER COLUMN body SET NOT NULL;

ALTER TABLE article_versions ALTER COLUMN body_doc DROP NOT NULL;

ALTER TABLE article_versions DROP CONSTRAINT article_versions_body_doc_root;
ALTER TABLE article_versions ADD CONSTRAINT article_versions_body_doc_root
    CHECK (
        body_doc IS NULL
        OR (
            jsonb_typeof(body_doc) = 'object'
            AND body_doc->>'tipo' = 'doc'
            AND jsonb_typeof(body_doc->'contenido') = 'array'
        )
    );

COMMIT;
