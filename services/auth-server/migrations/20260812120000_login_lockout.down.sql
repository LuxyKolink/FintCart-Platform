-- Revierte la protección ante intentos repetidos de inicio de sesión fallidos.

BEGIN;

ALTER TABLE credentials
    DROP CONSTRAINT IF EXISTS credentials_failed_login_attempts_non_negative;

ALTER TABLE credentials
    DROP COLUMN IF EXISTS failed_login_attempts,
    DROP COLUMN IF EXISTS locked_until;

COMMIT;
