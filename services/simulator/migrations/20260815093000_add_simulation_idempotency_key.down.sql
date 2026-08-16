-- Revierte 20260815093000_add_simulation_idempotency_key.
DROP INDEX IF EXISTS simulations_idempotency_key_unique;
ALTER TABLE simulations DROP COLUMN IF EXISTS idempotency_key;
