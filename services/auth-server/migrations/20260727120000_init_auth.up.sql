-- Servicio de Autenticación — esquema inicial (auth_db).
--
-- Autoridad de identidad y dueño de las credenciales (research D-04).
-- Los refresh tokens y la blacklist de JWT viven en Redis, NO aquí (Principio IV).
--
-- Principio III: esta base pertenece exclusivamente a auth-server. No hay claves
-- foráneas hacia otros servicios: las referencias cruzadas usan UUID opaco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- correo case-insensitive

-- ── credentials ────────────────────────────────────────────────────────────
-- `id` es el mismo UUID que `users.profiles.id` y que el claim `sub` del JWT.
CREATE TABLE credentials (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT      NOT NULL UNIQUE,             -- FR-001 unicidad; FR-030 anonimizable
    password_hash TEXT        NOT NULL,                    -- Argon2id; nunca en claro ni en logs
    login_status  TEXT        NOT NULL DEFAULT 'pending_verification',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Transiciones válidas (data-model §Autenticación):
    --   pending_verification --(EmailVerified)--> active
    --   active               --(AccountAnonymized)--> anonymized
    -- En 'pending_verification' se bloquea el acceso pleno (FR-002) y en
    -- 'anonymized' se imposibilita la emisión de tokens (FR-030).
    CONSTRAINT credentials_login_status_valid
        CHECK (login_status IN ('pending_verification', 'active', 'anonymized'))
);

COMMENT ON COLUMN credentials.login_status IS
    'FR-002: solo login_status = active permite emitir tokens. pending_verification bloquea el acceso pleno; anonymized lo impide de forma permanente (FR-030).';

-- ── oauth_clients ──────────────────────────────────────────────────────────
-- La SPA es cliente público (sin secreto, PKCE obligatorio); los clientes M2M
-- usan client_credentials con secreto (research D-05).
CREATE TABLE oauth_clients (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id          TEXT        NOT NULL UNIQUE,
    client_secret_hash TEXT,                                -- NULL para clientes públicos
    grant_types        TEXT[]      NOT NULL,
    redirect_uris      TEXT[]      NOT NULL DEFAULT '{}',
    scopes             TEXT[]      NOT NULL DEFAULT '{}',
    is_public          BOOLEAN     NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Un cliente público no puede tener secreto; uno confidencial debe tenerlo.
    CONSTRAINT oauth_clients_secret_matches_visibility
        CHECK ((is_public AND client_secret_hash IS NULL)
            OR (NOT is_public AND client_secret_hash IS NOT NULL)),

    -- Principio VII: solo se admiten los dos flujos de la constitución.
    CONSTRAINT oauth_clients_grant_types_allowed
        CHECK (grant_types <@ ARRAY['authorization_code', 'refresh_token', 'client_credentials']::TEXT[]),

    -- Un cliente público (la SPA) siempre redirige: sin redirect_uri, PKCE no aplica.
    CONSTRAINT oauth_clients_public_needs_redirect
        CHECK (NOT is_public OR cardinality(redirect_uris) > 0)
);

-- ── authorization_codes ────────────────────────────────────────────────────
-- Códigos de un solo uso con TTL corto (≤ 60 s) y PKCE S256 obligatorio.
CREATE TABLE authorization_codes (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                  TEXT        NOT NULL UNIQUE,
    client_id             TEXT        NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
    user_id               UUID        NOT NULL REFERENCES credentials (id) ON DELETE CASCADE,
    code_challenge        TEXT        NOT NULL,
    code_challenge_method TEXT        NOT NULL DEFAULT 'S256',
    redirect_uri          TEXT        NOT NULL,
    scopes                TEXT[]      NOT NULL DEFAULT '{}',
    expires_at            TIMESTAMPTZ NOT NULL,
    consumed              BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- 'plain' está explícitamente excluido: PKCE sin S256 no protege al cliente público.
    CONSTRAINT authorization_codes_method_s256
        CHECK (code_challenge_method = 'S256'),

    CONSTRAINT authorization_codes_ttl_short
        CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '60 seconds')
);

-- Barrido de códigos expirados y búsqueda del código en el intercambio.
CREATE INDEX authorization_codes_expires_at_idx
    ON authorization_codes (expires_at) WHERE NOT consumed;

CREATE INDEX credentials_login_status_idx ON credentials (login_status);

COMMIT;
