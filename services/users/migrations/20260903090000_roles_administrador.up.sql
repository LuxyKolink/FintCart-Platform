-- Servicio de Usuarios — cuarto rol 'administrador' en roles_assignment (FR-080).
--
-- Los tres roles de FR-006 se amplían con 'administrador', independiente de
-- 'coordinador_editorial' (FR-082). La columna `role` ya era TEXT con un CHECK;
-- se sustituye la constraint por una que admita el valor nuevo. Ninguna fila
-- existente cambia: la migración es puramente de estructura.

BEGIN;

ALTER TABLE roles_assignment
    DROP CONSTRAINT roles_assignment_role_valid;

ALTER TABLE roles_assignment
    ADD CONSTRAINT roles_assignment_role_valid
        CHECK (role IN ('usuario_final', 'editor', 'coordinador_editorial', 'administrador'));

COMMIT;
