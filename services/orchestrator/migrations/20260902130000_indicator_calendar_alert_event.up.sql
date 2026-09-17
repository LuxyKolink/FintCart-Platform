-- Aviso del procedimiento anual de indicadores: el tipo de evento nuevo (T105, FR-061).
--
-- `event_outbox_event_type_valid` enumera los eventos cuyo productor es el Orquestador
-- (`contracts/events/events-catalog.md` y Principio V). Se AMPLÍA, no se relaja: la lista
-- sigue siendo cerrada, y añadir un tipo sigue exigiendo una migración. Esa fricción es la
-- que evita que un evento se publique para nadie — el exchange `topic` acepta cualquier
-- routing key y un mensaje sin binding se descarta en silencio.

BEGIN;

ALTER TABLE event_outbox
    DROP CONSTRAINT event_outbox_event_type_valid;

ALTER TABLE event_outbox
    ADD CONSTRAINT event_outbox_event_type_valid
        CHECK (event_type IN ('user.registered', 'user.email_verified',
                              'learning.quiz_graded', 'user.progress_milestone',
                              'user.activity', 'simulation.executed',
                              'account.anonymized',
                              'indicator.calendar_alert'));

COMMIT;
