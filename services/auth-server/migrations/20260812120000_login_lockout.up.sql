-- Protección ante intentos repetidos de inicio de sesión fallidos (Edge Cases,
-- FR-005/auth.security_alert).
--
-- Se persiste en `auth_db` y no en Redis: Redis está reservado por el Principio IV
-- a la blacklist de JWT y a los refresh tokens, ninguno de los cuales es esto —un
-- contador de intentos es un dato de la CUENTA, con la misma necesidad de
-- durabilidad que su contraseña, no un valor con TTL que pueda perderse sin más
-- consecuencia que reiniciar una sesión.

BEGIN;

ALTER TABLE credentials
    ADD COLUMN failed_login_attempts INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN locked_until          TIMESTAMPTZ;

ALTER TABLE credentials
    ADD CONSTRAINT credentials_failed_login_attempts_non_negative
        CHECK (failed_login_attempts >= 0);

COMMENT ON COLUMN credentials.failed_login_attempts IS
    'Intentos fallidos consecutivos desde el último login exitoso o el último bloqueo. Se reinicia a 0 en cada autenticación válida.';
COMMENT ON COLUMN credentials.locked_until IS
    'NULL si la cuenta no está bloqueada. Un login con email válido durante el bloqueo se rechaza igual que una contraseña incorrecta (FR-002 no distingue los dos casos ante el cliente).';

COMMIT;
