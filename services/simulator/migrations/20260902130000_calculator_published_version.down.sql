-- Revierte la separación entre versión publicada y versión vigente (T113).
--
-- Las calculadoras que tuvieran un borrador sin aprobar —`version > published_version`— se
-- quedan con la versión publicada, que es la única definición por la que este esquema puede
-- responder sin volver a decidir una curaduría que ya se decidió. Es una pérdida deliberada y
-- acotada: el borrador sigue en `calculator_definitions` —esta migración no borra
-- definiciones—, pero deja de estar referenciado por la identidad, así que revertir y volver a
-- aplicar la migración `up` no lo recupera.

BEGIN;

-- La condición de la clave foránea no se puede revertir sin resolver antes las filas que la
-- incumplirían: si `version` y `published_version` difieren, dejar solo `version` es lo
-- honesto —lo publicado pasó a ser lo vigente— y es exactamente el estado anterior a esta
-- migración.
UPDATE calculators
   SET version = published_version
 WHERE published_version IS NOT NULL
   AND published_version <> version;

ALTER TABLE calculators
    DROP CONSTRAINT calculators_published_version_exists,
    DROP CONSTRAINT calculators_published_has_version,
    DROP CONSTRAINT calculators_published_version_range,
    DROP CONSTRAINT calculators_rejection_reason_bounded;

ALTER TABLE calculators DROP COLUMN published_version;

COMMIT;
