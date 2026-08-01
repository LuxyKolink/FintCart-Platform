-- Token de verificación de correo (FR-002).
--
-- Hasta aquí, `pending_verification → active` no exigía ninguna prueba: bastaba
-- conocer el `user_id` —que viaja en el `actor_ref` de cada evento de auditoría—
-- para activar la cuenta de otra persona, y el correo de verificación no
-- comprobaba nada. Estas dos columnas son esa prueba.

BEGIN;

ALTER TABLE credentials
    -- SHA-256 en hexadecimal del token, nunca el token. Un volcado de esta tabla
    -- no puede activar ninguna cuenta pendiente, igual que no puede iniciar
    -- sesión con `password_hash`.
    --
    -- SHA-256 y no Argon2id, a diferencia de la contraseña: el token son 256 bits
    -- de un CSPRNG, así que no hay diccionario que probar ni contraseña reusada
    -- que proteger. El coste de memoria de Argon2id defiende de un ataque que
    -- aquí no existe, y lo pagaría cada verificación.
    ADD COLUMN verification_token_hash       TEXT,
    -- Sin caducidad, un enlace filtrado de un correo antiguo seguiría activando la
    -- cuenta años después.
    ADD COLUMN verification_token_expires_at TIMESTAMPTZ;

-- Los dos campos son un solo dato. Por separado admitirían un hash sin caducidad
-- —que nunca expira— o una caducidad sin hash, que no verifica nada.
ALTER TABLE credentials
    ADD CONSTRAINT credentials_verification_token_paired
        CHECK ((verification_token_hash IS NULL) = (verification_token_expires_at IS NULL));

COMMENT ON COLUMN credentials.verification_token_hash IS
    'SHA-256 hex del token de verificación. Se pone a NULL al activar: el token es de un solo uso.';

COMMIT;
