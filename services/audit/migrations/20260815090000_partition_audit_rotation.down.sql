-- Revierte 20260815090000_partition_audit_rotation.
--
-- Elimina solo lo que esta migración añadió: las particiones 2028-2030 y la
-- función de rotación. Las particiones 2026/2027/default, el trigger de
-- inmutabilidad y sus REVOKE son del esquema inicial y siguen intactos.
BEGIN;

DROP TABLE IF EXISTS audit_log_2028;
DROP TABLE IF EXISTS audit_log_2029;
DROP TABLE IF EXISTS audit_log_2030;

DROP FUNCTION IF EXISTS audit_log_ensure_partition(INT);

COMMIT;
