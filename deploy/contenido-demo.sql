-- Catálogo de demostración de Fintcart: cinco categorías temáticas (SC-009), cada una con
-- un artículo publicado y su documento de bloques, y un cuestionario sobre el primero.
--
-- ESTE FICHERO LO USAN LOS DOS ENTORNOS, y por eso está aquí y no dentro de uno de ellos:
--   · `dev/seed`                (entorno de desarrollo)
--   · `deploy/vps/seed-contenido` (despliegue del colegio)
-- Vivía embebido en `dev/seed`, y el día que hizo falta en el despliegue la alternativa era
-- copiarlo —dos copias del mismo contenido, que se separan en cuanto alguien toque una—.
--
-- Es IDEMPOTENTE: se puede ejecutar tantas veces como haga falta sin duplicar nada
-- (`ON CONFLICT ... DO NOTHING` en cada inserción), porque se lanza a mano y contra bases
-- que ya están en marcha.
--
-- Las identidades del editor y del coordinador son UUID opacos que NO existen en Usuarios, y
-- no hace falta que existan: Aprendizaje guarda referencias opacas y nunca lee la base de
-- otro servicio (Principio III). Eso es lo que permite sembrar el catálogo en un despliegue
-- donde todavía no hay ninguna cuenta creada.

BEGIN;

-- Identidades opacas del contenido de ejemplo. No existen en Usuarios y no hace
-- falta que existan: Aprendizaje guarda referencias opacas y NUNCA lee la base de
-- otro servicio (Principio III).
CREATE TEMP TABLE seed_ids (editor UUID, coordinador UUID) ON COMMIT DROP;
INSERT INTO seed_ids VALUES (
  '00000000-0000-4000-8000-0000000ed170',
  '00000000-0000-4000-8000-00000000c007'
);

-- Categorías temáticas (SC-009). La migración de conversión ya deja las canónicas en
-- una base nueva, pero `dev/seed` no debe depender del orden en que se poblaron: se
-- aseguran aquí de forma idempotente. Las posiciones se encadenan tras el máximo
-- existente para no chocar con `categories_position_active_uniq`.
INSERT INTO categories (name, slug, position)
SELECT c.name, c.slug, (base.max_position + c.ord)::integer
FROM (VALUES
  (1, 'Presupuesto',          'presupuesto'),
  (2, 'Ahorro',               'ahorro'),
  (3, 'Crédito',              'credito'),
  (4, 'Inversión',            'inversion'),
  (5, 'Seguridad financiera', 'seguridad-financiera')
) AS c(ord, name, slug)
CROSS JOIN (SELECT COALESCE(max(position), 0) AS max_position FROM categories) base
ON CONFLICT (slug) DO NOTHING;

-- `articles.category` (texto libre) desapareció en la migración 20260902101500:
-- ahora es `category_id` y la identidad de la categoría es su `slug`. El JOIN, y no
-- un identificador fijo, mantiene la siembra atada al catálogo real (FR-034).
INSERT INTO articles (id, title, category_id, author_id)
SELECT v.id, v.title, c.id, s.editor
FROM seed_ids s
CROSS JOIN (VALUES
  ('00000000-0000-4000-8000-000000000a01'::UUID, 'Cómo construir tu primer presupuesto mensual', 'presupuesto'),
  ('00000000-0000-4000-8000-000000000a02'::UUID, 'El fondo de emergencia: cuánto y dónde', 'ahorro'),
  ('00000000-0000-4000-8000-000000000a03'::UUID, 'Entender la tasa efectiva anual antes de pedir un crédito', 'credito'),
  ('00000000-0000-4000-8000-000000000a04'::UUID, 'Interés compuesto: por qué el tiempo pesa más que el monto', 'inversion'),
  ('00000000-0000-4000-8000-000000000a05'::UUID, 'El 4x1000 y otros costos que no aparecen en la tasa', 'seguridad-financiera')
) AS v(id, title, category_slug)
JOIN categories c ON c.slug = v.category_slug
ON CONFLICT (id) DO NOTHING;

-- La siembra escribe el DOCUMENTO de bloques de cada artículo, y **no** el texto plano.
--
-- Escribir solo `body` —una columna de texto— funcionó mientras el lector tenía una caída
-- al texto plano: la siembra podía saltarse el invariante y nada se notaba, porque quien
-- leía el artículo completaba el hueco por detrás. Con T135 (`body` eliminado) una siembra
-- que no escriba `body_doc` **deja los artículos sin cuerpo**, y el lector ya no tiene de
-- dónde sacarlo. Se descubrió aplicando esa migración: su guarda se negó a borrar el texto
-- de las cinco versiones sembradas, que no tenían documento.
--
-- El texto viaja como LITERAL del `VALUES` y no como columna: así esta siembra es la misma
-- antes y después de que la columna desaparezca, y la conversión —un párrafo por bloque
-- separado por una línea en blanco— es la misma regla que la de `plain-text.ts` y la de la
-- migración `20260902111500`.
CREATE TEMP TABLE pg_temp.siembra_articulos AS
SELECT v.id,
       v.article_id,
       v.body,
       jsonb_build_object(
           'tipo', 'doc',
           'contenido', coalesce(
               (
                   SELECT jsonb_agg(
                              jsonb_build_object(
                                  'tipo', 'parrafo',
                                  'contenido', jsonb_build_array(
                                      jsonb_build_object('tipo', 'texto', 'texto', btrim(part))
                                  )
                              ) ORDER BY ord
                          )
                     FROM unnest(regexp_split_to_array(v.body, E'\n\n')) WITH ORDINALITY AS t(part, ord)
                    WHERE btrim(part) <> ''
               ),
               '[]'::jsonb
           )
       ) AS body_doc
  FROM (VALUES
  ('00000000-0000-4000-8000-000000000b01'::UUID, '00000000-0000-4000-8000-000000000a01'::UUID,
   E'Un presupuesto no es una lista de prohibiciones: es una fotografía de a dónde va tu dinero.\n\nEmpieza por registrar un mes completo de gastos reales, sin corregir nada. La mayoría de la gente descubre que entre el 15 % y el 25 % de sus egresos no encaja en ninguna categoría que hubiera anticipado.\n\nCon esa base, agrupa en tres bloques: fijos, variables y ahorro. La regla que mejor aguanta el paso del tiempo no es un porcentaje concreto, sino que el ahorro salga PRIMERO y no de lo que sobra.'),
  ('00000000-0000-4000-8000-000000000b02'::UUID, '00000000-0000-4000-8000-000000000a02'::UUID,
   E'El fondo de emergencia existe para que un imprevisto no se convierta en una deuda cara.\n\nLa cifra habitual —de tres a seis meses de gastos— depende de algo que casi nunca se menciona: la estabilidad de tu ingreso. Un salario fijo admite tres meses; un ingreso variable o independiente pide seis o más.\n\nDónde guardarlo importa tanto como cuánto: tiene que ser líquido y de bajo riesgo. Un fondo de emergencia invertido en algo volátil deja de ser un fondo de emergencia justo el día que lo necesitas.'),
  ('00000000-0000-4000-8000-000000000b03'::UUID, '00000000-0000-4000-8000-000000000a03'::UUID,
   E'Dos créditos con la misma cuota mensual pueden costar cantidades muy distintas.\n\nLa tasa que aparece en la publicidad suele ser NOMINAL. La que de verdad mide lo que pagas es la EFECTIVA ANUAL, que incorpora el efecto de capitalizar los intereses a lo largo del año.\n\nAntes de firmar, convierte siempre a efectiva anual y compara ahí. Y suma los costos que no van en la tasa: estudio de crédito, seguros asociados y comisiones de manejo.'),
  ('00000000-0000-4000-8000-000000000b04'::UUID, '00000000-0000-4000-8000-000000000a04'::UUID,
   E'El interés compuesto es interés que gana interés, y su efecto no es lineal sino acelerado.\n\nDe ahí la conclusión que sorprende: empezar temprano con montos pequeños suele superar a empezar tarde con montos grandes. El tiempo entra como exponente; el monto, apenas como factor.\n\nEl mismo mecanismo opera en tu contra en una deuda de tarjeta de crédito. Es la misma fórmula, con el signo cambiado.'),
  ('00000000-0000-4000-8000-000000000b05'::UUID, '00000000-0000-4000-8000-000000000a05'::UUID,
   E'En Colombia, el Gravamen a los Movimientos Financieros —el 4x1000— cobra cuatro pesos por cada mil que salen de tu cuenta.\n\nParece poco hasta que mueves dinero con frecuencia: veinte traslados de un millón cuestan ochenta mil pesos al año en un impuesto que nadie te cobra de forma visible.\n\nExiste una exención por cuenta marcada, hasta un tope mensual en UVT. Marcar la cuenta correcta es de las decisiones de mayor rendimiento por minuto invertido que existen.')
) AS v(id, article_id, body);

-- Dos `INSERT` y no uno, porque la columna puede estar o no: el `NOT NULL` de `body` impide
-- insertar sin ella antes de T135, y después de T135 nombrarla es un error. Elegir rama en
-- tiempo de ejecución es lo que hace que el mismo script sirva en una base a medio migrar y
-- en una ya migrada —y que nadie tenga que acordarse de en qué punto está la suya—.
DO $$
DECLARE
    hay_body boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'article_versions' AND column_name = 'body'
    ) INTO hay_body;

    IF hay_body THEN
        EXECUTE $insertar$
            INSERT INTO article_versions
                (id, article_id, version_no, body, body_doc, state, created_by, approved_by, published_at)
            SELECT a.id, a.article_id, 1, a.body, a.body_doc, 'publicado', s.editor, s.coordinador, now()
              FROM pg_temp.siembra_articulos a, seed_ids s
            ON CONFLICT (id) DO NOTHING
        $insertar$;
    ELSE
        EXECUTE $insertar$
            INSERT INTO article_versions
                (id, article_id, version_no, body_doc, state, created_by, approved_by, published_at)
            SELECT a.id, a.article_id, 1, a.body_doc, 'publicado', s.editor, s.coordinador, now()
              FROM pg_temp.siembra_articulos a, seed_ids s
            ON CONFLICT (id) DO NOTHING
        $insertar$;
    END IF;
END
$$;

DROP TABLE pg_temp.siembra_articulos;

-- Reparación de lo que una siembra ANTERIOR dejó a medias: las versiones sembradas sin
-- documento tienen su texto en `body`, y la migración que elimina esa columna se niega —con
-- razón— a borrarla cuando no hay documento que la sustituya. Se rellena desde su propio
-- texto y no se toca ninguna que ya lo tenga, así que se puede ejecutar cuantas veces haga
-- falta. Va ANTES del `INSERT` porque el caso que repara es justo el de una base que ya
-- tenía estos artículos.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'article_versions' AND column_name = 'body'
    ) THEN
        EXECUTE $reparar$
            UPDATE article_versions v
               SET body_doc = jsonb_build_object(
                       'tipo', 'doc',
                       'contenido', coalesce(
                           (
                               SELECT jsonb_agg(
                                          jsonb_build_object(
                                              'tipo', 'parrafo',
                                              'contenido', jsonb_build_array(
                                                  jsonb_build_object('tipo', 'texto', 'texto', btrim(part))
                                              )
                                          ) ORDER BY ord
                                      )
                                 FROM unnest(regexp_split_to_array(v.body, E'\n\n'))
                                      WITH ORDINALITY AS t(part, ord)
                                WHERE btrim(part) <> ''
                           ),
                           '[]'::jsonb
                       )
                   )
             WHERE v.body_doc IS NULL
        $reparar$;
        RAISE NOTICE 'siembra: documentos de bloques reparados para las versiones que no los tenían';
    END IF;
END
$$;

UPDATE articles a
   SET current_version_id = av.id
  FROM article_versions av
 WHERE av.article_id = a.id
   AND av.state = 'publicado'
   AND a.current_version_id IS NULL;

-- Un cuestionario con tres preguntas de peso desigual: el puntaje resultante
-- (66.67) es un decimal periódico, que es justo el caso en el que un `float`
-- delataría el error de redondeo (Principio VIII).
INSERT INTO quizzes (id, article_id, title, pass_threshold)
VALUES (
  '00000000-0000-4000-8000-000000000c01',
  '00000000-0000-4000-8000-000000000a01',
  'Presupuesto mensual: comprobación de lectura',
  70.00
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO questions (id, quiz_id, prompt, options, correct_key, weight, position)
VALUES
  ('00000000-0000-4000-8000-000000000d01',
   '00000000-0000-4000-8000-000000000c01',
   '¿Con qué conviene empezar un presupuesto?',
   '{"a": "Fijando un límite por categoría", "b": "Registrando un mes de gastos reales", "c": "Cancelando las suscripciones"}'::JSONB,
   'b', 1.00, 1),
  ('00000000-0000-4000-8000-000000000d02',
   '00000000-0000-4000-8000-000000000c01',
   '¿Qué lugar debería ocupar el ahorro?',
   '{"a": "Lo que sobre a fin de mes", "b": "Antes que los gastos variables", "c": "Solo en meses con prima"}'::JSONB,
   'b', 1.00, 2),
  ('00000000-0000-4000-8000-000000000d03',
   '00000000-0000-4000-8000-000000000c01',
   '¿Qué proporción del gasto suele escapar a las categorías previstas?',
   '{"a": "Menos del 5 %", "b": "Entre el 15 % y el 25 %", "c": "Más de la mitad"}'::JSONB,
   'b', 1.00, 3)
ON CONFLICT (id) DO NOTHING;

COMMIT;
