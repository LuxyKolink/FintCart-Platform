-- Revierte 20260727120000_init_auth.
-- Orden inverso a las dependencias: authorization_codes referencia a ambas.
BEGIN;

DROP INDEX IF EXISTS credentials_login_status_idx;
DROP INDEX IF EXISTS authorization_codes_expires_at_idx;

DROP TABLE IF EXISTS authorization_codes;
DROP TABLE IF EXISTS oauth_clients;
DROP TABLE IF EXISTS credentials;

-- Las extensiones NO se eliminan: pueden estar en uso por otro objeto de la
-- base y su creación es idempotente (CREATE EXTENSION IF NOT EXISTS).

COMMIT;
