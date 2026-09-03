-- Revierte 20260903090000_roles_administrador: vuelve al CHECK de FR-006.
--
-- Si hubiera cuentas con rol 'administrador', esta reversión fallaría al violar
-- la constraint nueva; es el comportamiento correcto para una migración hacia
-- atrás (no se puede descender a un esquema que los datos ya no caben).

BEGIN;

ALTER TABLE roles_assignment
    DROP CONSTRAINT roles_assignment_role_valid;

ALTER TABLE roles_assignment
    ADD CONSTRAINT roles_assignment_role_valid
        CHECK (role IN ('usuario_final', 'editor', 'coordinador_editorial'));

COMMIT;
