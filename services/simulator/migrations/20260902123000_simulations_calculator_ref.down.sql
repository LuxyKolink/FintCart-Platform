-- Revierte 20260902123000_simulations_calculator_ref.
--
-- Se sueltan las guardias antes que las columnas: un CHECK que referencie una columna
-- ya eliminada impediría el DROP COLUMN. El relleno del historial no se deshace —era
-- información deducible, no un dato nuevo—, así que revertir y volver a aplicar deja
-- el mismo estado mientras `dev/seed` haya sembrado.
DROP INDEX IF EXISTS simulations_calculator_idx;

ALTER TABLE simulations DROP CONSTRAINT IF EXISTS simulations_indicators_snapshot_no_json_numbers;
ALTER TABLE simulations DROP CONSTRAINT IF EXISTS simulations_indicators_snapshot_is_object;
ALTER TABLE simulations DROP CONSTRAINT IF EXISTS simulations_calculator_version_positive;
ALTER TABLE simulations DROP CONSTRAINT IF EXISTS simulations_calculator_version_requires_id;

ALTER TABLE simulations DROP COLUMN IF EXISTS indicators_snapshot;
ALTER TABLE simulations DROP COLUMN IF EXISTS calculator_version;
ALTER TABLE simulations DROP COLUMN IF EXISTS calculator_id;
