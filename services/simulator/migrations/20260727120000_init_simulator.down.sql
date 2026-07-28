-- Revierte 20260727120000_init_simulator.
BEGIN;

DROP INDEX IF EXISTS simulations_calc_type_idx;
DROP INDEX IF EXISTS simulations_user_created_idx;
DROP TABLE IF EXISTS simulations;
DROP FUNCTION IF EXISTS jsonb_has_no_numbers(JSONB);

COMMIT;
