-- Revierte 20260727120000_init_orchestrator.
BEGIN;

DROP INDEX IF EXISTS event_outbox_pending_idx;
DROP INDEX IF EXISTS saga_state_type_status_idx;
DROP INDEX IF EXISTS saga_state_resumable_idx;

DROP TABLE IF EXISTS event_outbox;
DROP TABLE IF EXISTS saga_state;

COMMIT;
