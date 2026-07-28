-- Servicio de Auditoría — esquema inicial (audit_db).
--
-- Registro INMUTABLE y APPEND-ONLY (FR-025). Es la fuente autoritativa de
-- trazabilidad regulatoria: los logs operacionales NO la sustituyen.
--
-- La inmutabilidad se impone en la BASE, no solo en la aplicación: se revocan
-- UPDATE y DELETE sobre la tabla para el rol de la aplicación. Un bug en el
-- servicio no puede alterar el histórico.
--
-- FR-030: `actor_ref` es un ID OPACO que sobrevive a la anonimización del
-- titular. La saga de anonimización NUNCA toca esta tabla.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Particionada por año desde el inicio: la retención es de ≥ 5 años (FR-031) y
-- convertir una tabla grande a particionada más tarde es costoso.
CREATE TABLE audit_log (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    actor_ref   UUID        NOT NULL,                       -- ID opaco (FR-030)
    operation   TEXT        NOT NULL,
    context     JSONB       NOT NULL DEFAULT '{}'::JSONB,   -- detalle NO-PII / despersonalizado
    result      TEXT        NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id, occurred_at),

    CONSTRAINT audit_log_result_valid CHECK (result IN ('success', 'failure')),
    CONSTRAINT audit_log_operation_not_blank CHECK (length(btrim(operation)) > 0)
) PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE audit_log IS
    'FR-025/FR-031: append-only, inmutable, retención mínima de 5 años. Solo INSERT — UPDATE y DELETE están revocados. Fuente autoritativa para auditorías regulatorias del sector financiero colombiano.';

COMMENT ON COLUMN audit_log.actor_ref IS
    'FR-030: identificador OPACO del actor. Sobrevive a la anonimización del titular y no permite re-identificarlo. La saga de anonimización nunca modifica esta tabla.';

-- Particiones iniciales. T174 añade la rotación anual automatizada.
CREATE TABLE audit_log_2026 PARTITION OF audit_log
    FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
CREATE TABLE audit_log_2027 PARTITION OF audit_log
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');

-- Una partición por defecto evita que un evento con fecha inesperada haga
-- fallar el INSERT: perder un registro de auditoría es peor que guardarlo fuera
-- de su partición anual.
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

-- Consultas regulatorias: por actor y por tipo de operación, en una ventana.
CREATE INDEX audit_log_actor_idx ON audit_log (actor_ref, occurred_at DESC);
CREATE INDEX audit_log_operation_idx ON audit_log (operation, occurred_at DESC);

-- ── Inmutabilidad ──────────────────────────────────────────────────────────
-- El servicio se conecta con el rol `fintcart`, que debe poder INSERT y SELECT
-- pero nunca UPDATE ni DELETE. REVOKE sobre la tabla particionada se propaga a
-- las particiones existentes; las futuras las crea T174 con el mismo patrón.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log_2026 FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log_2027 FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log_default FROM PUBLIC;

-- El propietario de la tabla conserva sus privilegios por definición, así que
-- la revocación anterior no basta si el servicio se conecta como propietario.
-- Un trigger cierra ese hueco de forma independiente del rol.
CREATE OR REPLACE FUNCTION audit_log_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'audit_log es append-only (FR-025): % no está permitido', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();

CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();

COMMIT;
