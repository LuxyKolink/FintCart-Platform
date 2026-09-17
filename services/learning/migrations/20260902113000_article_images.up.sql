-- Servicio de Aprendizaje — `article_images` (FR-064…FR-067, research D-13).
--
-- Las imágenes viven en la base y no en un sistema de archivos ni en un
-- servicio de objetos: el proyecto no añade infraestructura en esta enmienda
-- (D-13), y el tope de 2 MB hace que una fila sea un soporte razonable.
--
-- El identificador es el **SHA-256 del contenido**, de modo que subir dos veces
-- la misma imagen no duplica bytes: la segunda subida encuentra la fila. Eso es
-- el direccionamiento por contenido, y es la razón de que esta tabla no tenga
-- `id` sintético.
--
-- El `alt` y el pie de foto NO viven aquí aunque la interfaz los pida junto a la
-- imagen: pertenecen al **uso** de la imagen en una versión concreta, no al
-- archivo. Viven en el nodo `imagen` de `body_doc`. Es lo que permite que dos
-- versiones compartan la misma imagen con pies distintos y lo que hace que
-- FR-067 se cumpla sin duplicar bytes (data-model §1.4).
--
-- Las filas son inmutables: no hay `updated_at` ni camino de actualización.
--
-- `byte_size` se guarda aunque sea deducible de `bytes`: leer el tamaño sin
-- traer el BYTEA es justo lo que evita una consulta de listado pesada. Ahora
-- bien, un dato derivado que no se comprueba es una mentira esperando su turno,
-- así que se impone `byte_size = octet_length(bytes)`. Sin esa igualdad, el tope
-- de 2 MB sería una promesa sobre una columna que nadie compara con el contenido
-- real y bastaría declarar `byte_size = 1` para guardar lo que fuera.

BEGIN;

CREATE TABLE article_images (
    id          TEXT        PRIMARY KEY,
    article_id  UUID        NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
    mime_type   TEXT        NOT NULL,
    byte_size   INTEGER     NOT NULL,
    width       INTEGER     NOT NULL,
    height      INTEGER     NOT NULL,
    bytes       BYTEA       NOT NULL,
    uploaded_by UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- El identificador ES el hash: 64 dígitos hexadecimales en minúscula. El
    -- CHECK documenta el contrato y ataja una escritura que lo incumpla, que es
    -- la única forma de que «direccionamiento por contenido» siga siendo cierto
    -- dentro de un año.
    CONSTRAINT article_images_id_is_sha256
        CHECK (id ~ '^[0-9a-f]{64}$'),
    CONSTRAINT article_images_mime_allowed
        CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT article_images_size_cap
        CHECK (byte_size > 0 AND byte_size <= 2097152),
    CONSTRAINT article_images_size_matches_bytes
        CHECK (byte_size = octet_length(bytes)),
    CONSTRAINT article_images_dims_positive
        CHECK (width > 0 AND height > 0)
);

-- Fuera de la tupla: las imágenes no se comprimen con el resto de la fila ni se
-- traen en un `SELECT *` que no las pida (TOAST).
ALTER TABLE article_images ALTER COLUMN bytes SET STORAGE EXTERNAL;

-- El borrado de un artículo arrastra sus imágenes (ON DELETE CASCADE), y ese
-- camino necesita índice para no recorrer la tabla entera.
CREATE INDEX article_images_article_idx ON article_images (article_id);

COMMIT;
