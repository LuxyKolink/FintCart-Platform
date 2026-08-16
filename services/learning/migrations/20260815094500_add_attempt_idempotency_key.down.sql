-- Revierte 20260815094500_add_attempt_idempotency_key.
DROP INDEX IF EXISTS quiz_attempts_idempotency_key_unique;
ALTER TABLE quiz_attempts DROP COLUMN IF EXISTS idempotency_key;
