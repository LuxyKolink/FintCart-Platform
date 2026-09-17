-- Versión PUBLICADA aparte de la versión vigente (T113; FR-052, FR-053, FR-054).
--
-- ## El problema que resuelve
--
-- `calculators.version` era «la versión que se sirve» y a la vez «la última escrita», y esas
-- dos cosas dejan de coincidir en cuanto una calculadora publicada se edita. `upsert` sube
-- `version` e inserta la definición nueva, así que el catálogo público pasaba a servir una
-- definición que **nadie había aprobado**: exactamente lo que SC-018 prohíbe («ninguna
-- calculadora llega al catálogo público sin haber sido aprobada por un coordinador distinto
-- de su autor»).
--
-- Con esta columna, la versión vigente es el BORRADOR del autor y `published_version` es la
-- última aprobada. Editar una calculadora publicada ya no cambia lo que ve el mundo: el
-- catálogo y los artículos siguen sirviendo la versión aprobada mientras el autor prepara la
-- siguiente (FR-052).
--
-- ## Por qué la clave foránea es DIFERIBLE
--
-- `(id, published_version)` apunta a `calculator_definitions (calculator_id, version)`, que es
-- lo que impide que una calculadora quede publicada apuntando a una definición que no existe.
-- La relación es circular a propósito —`calculator_definitions` ya referencia a `calculators`
-- con `ON DELETE CASCADE`—, y por eso la comprobación tiene que esperar al final de la
-- transacción: al borrar una calculadora, PostgreSQL se lleva sus definiciones en cascada y,
-- con la comprobación inmediata, la clave foránea saltaría contra la propia fila que se está
-- borrando. Comprobado contra PostgreSQL antes de escribir esto: con
-- `DEFERRABLE INITIALLY DEFERRED` el borrado en cascada funciona y el apunte a una versión
-- inexistente se sigue rechazando al confirmar.

BEGIN;

ALTER TABLE calculators ADD COLUMN published_version INTEGER;

-- Las que ya estaban publicadas tenían una única versión, y era la aprobada: la semilla de la
-- plataforma o la que pasó por curaduría antes de que existiera esta columna.
UPDATE calculators SET published_version = version WHERE state = 'publicada';

-- Un motivo de rechazo no puede ser vacío (FR-054: el rechazo «MUST registrar un motivo»). La
-- limpieza previa existe porque añadir un `CHECK` a una tabla con filas que lo incumplen falla:
-- ninguna fila debería tenerlo vacío —el rechazo no estaba implementado— pero una migración que
-- supone que la base está limpia es una migración que falla en el despliegue de otro.
UPDATE calculators
   SET rejection_reason = NULL
 WHERE rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) = 0;

ALTER TABLE calculators
    -- Un motivo de rechazo se lee en pantalla, así que tiene que caber y no puede ser solo
    -- espacios. Sin tope, un cliente podría dejar un motivo de megabytes que la interfaz no
    -- puede mostrar y que nadie revisó al aprobar el siguiente intento.
    ADD CONSTRAINT calculators_rejection_reason_bounded
        CHECK (
            rejection_reason IS NULL
            OR length(btrim(rejection_reason)) BETWEEN 1 AND 1000
        ),

    -- Un apunte dentro del rango de versiones escritas. No basta con la clave foránea de
    -- abajo: esta comprobación falla en el momento y con un mensaje que se lee, mientras que
    -- la foránea es diferida y su error nombra una fila.
    ADD CONSTRAINT calculators_published_version_range
        CHECK (published_version IS NULL OR published_version BETWEEN 1 AND version),

    -- Publicada implica versión aprobada. Es la expresión en el esquema de SC-018, y cierra
    -- el camino por el que una calculadora `publicada` sin aprobación previa podría llegar al
    -- catálogo: `calculators_published_requires_approval` exige el aprobador y esta exige la
    -- versión.
    ADD CONSTRAINT calculators_published_has_version
        CHECK (state <> 'publicada' OR published_version IS NOT NULL),

    -- La definición apuntada tiene que existir. Sin esto, un error de escritura dejaría una
    -- calculadora publicada cuyo `JOIN` por versión no encuentra fila, y el síntoma sería una
    -- calculadora invisible en el catálogo —un 404 donde debería haber un dato—.
    ADD CONSTRAINT calculators_published_version_exists
        FOREIGN KEY (id, published_version)
        REFERENCES calculator_definitions (calculator_id, version)
        DEFERRABLE INITIALLY DEFERRED;

COMMIT;
