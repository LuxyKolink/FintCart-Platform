-- Revierte 20260727120000_init_audit.
--
-- NOTA: revertir esta migración DESTRUYE el registro de auditoría. Solo es
-- admisible en desarrollo local. En cualquier entorno con datos reales, la
-- retención mínima de 5 años (FR-031) hace que ejecutar este down sea una
-- violación de cumplimiento, no una operación de mantenimiento.
BEGIN;

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
DROP FUNCTION IF EXISTS audit_log_reject_mutation();

DROP INDEX IF EXISTS audit_log_operation_idx;
DROP INDEX IF EXISTS audit_log_actor_idx;

-- DROP sobre la tabla particionada elimina también sus particiones.
DROP TABLE IF EXISTS audit_log;

COMMIT;
