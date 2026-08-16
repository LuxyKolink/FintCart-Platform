-- Rotación anual de particiones de audit_log (FR-031, T174).
--
-- El esquema inicial (20260727120000) creó las particiones 2026 y 2027 más una
-- partición DEFAULT de resguardo, con la nota «T174 añade la rotación anual
-- automatizada». Esta migración: (1) extiende la cobertura a 2030, cumpliendo
-- la retención mínima de 5 años (2026-2030) exigida por FR-031; (2) añade la
-- función `audit_log_ensure_partition`, que una tarea operativa anual (fuera
-- del alcance de esta migración: el plan no incluye un orquestador de cron)
-- puede invocar para crear la partición del año siguiente sin reescribir SQL
-- a mano cada vez ni bloquear escrituras mientras tanto.
--
-- Cada partición nueva repite el REVOKE del esquema inicial: el trigger
-- `audit_log_no_update`/`audit_log_no_delete` ya cubre TODAS las particiones
-- (se define sobre la tabla particionada, no sobre cada hija, y Postgres
-- dispara los triggers BEFORE de la tabla raíz para cualquier partición), pero
-- el REVOKE de privilegios es por relación individual y no se hereda solo —
-- sin repetirlo aquí, una partición nueva quedaría mutable para el propietario
-- de la tabla, aunque el trigger igual la protegiera.

BEGIN;

CREATE OR REPLACE FUNCTION audit_log_ensure_partition(p_year INT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    partition_name TEXT := format('audit_log_%s', p_year);
    range_start    TIMESTAMPTZ := make_timestamptz(p_year, 1, 1, 0, 0, 0, 'UTC');
    range_end      TIMESTAMPTZ := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'UTC');
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
        RETURN;
    END IF;

    EXECUTE format(
        'CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
        partition_name, range_start, range_end
    );
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM PUBLIC', partition_name);
END;
$$;

COMMENT ON FUNCTION audit_log_ensure_partition(INT) IS
    'FR-031: crea (idempotente) la partición anual de audit_log para el año dado, con el mismo REVOKE de mutación que las particiones del esquema inicial. Pensada para invocarse una vez al año desde una tarea operativa.';

-- Cobertura mínima de 5 años desde esta migración (2026-2030). 2026 y 2027 ya
-- existen desde el esquema inicial; la función es idempotente, así que
-- invocarla sobre ellos también sería inofensiva, pero se omite para no tocar
-- particiones cuyo REVOKE ya se aplicó.
SELECT audit_log_ensure_partition(2028);
SELECT audit_log_ensure_partition(2029);
SELECT audit_log_ensure_partition(2030);

COMMIT;
