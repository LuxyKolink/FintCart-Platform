-- Revierte 20260727120000_init_notification.
BEGIN;

DROP INDEX IF EXISTS notification_states_updated_idx;
DROP INDEX IF EXISTS notification_states_state_idx;
DROP INDEX IF EXISTS notification_events_queue_created_idx;

DROP TABLE IF EXISTS notification_states;
DROP TABLE IF EXISTS notification_events_queue;

COMMIT;
