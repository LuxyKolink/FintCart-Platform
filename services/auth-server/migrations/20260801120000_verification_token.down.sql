-- Revierte el token de verificación de correo.
--
-- Al deshacer esta migración, `ActivateCredential` vuelve a activar cuentas sin
-- comprobar nada. No es una reversión inocua: solo tiene sentido junto con la del
-- código que la usa.

BEGIN;

ALTER TABLE credentials
    DROP CONSTRAINT IF EXISTS credentials_verification_token_paired;

ALTER TABLE credentials
    DROP COLUMN IF EXISTS verification_token_hash,
    DROP COLUMN IF EXISTS verification_token_expires_at;

COMMIT;
