-- Aprobación de una calculadora: el tipo de saga y el evento de auditoría (T115, FR-053).
--
-- Dos CHECK de este esquema enumeran vocabulario cerrado, y los dos crecen:
--
--   · `saga_state_type_valid` — el tipo de saga de la curaduría. Es una saga y no una
--     llamada suelta porque tiene DOS pasos (aprobar en el Simulador y publicar el evento) y
--     el motor es lo que garantiza que el evento salga por el outbox en la MISMA transacción
--     que el avance (research D-07).
--   · `event_outbox_event_type_valid` — `calculator.published`, que va SOLO a Auditoría. El
--     evento no produce correo: al autor le basta con ver su calculadora en el catálogo, y un
--     correo por cada aprobación sería ruido.
--
-- Se AMPLÍAN, no se relajan: las listas siguen siendo cerradas y añadir un tipo sigue
-- exigiendo una migración. Esa fricción es la que evita que un evento se publique para nadie
-- —el exchange `topic` acepta cualquier routing key y un mensaje sin binding se descarta en
-- silencio—.

BEGIN;

ALTER TABLE saga_state
    DROP CONSTRAINT saga_state_type_valid;

ALTER TABLE saga_state
    ADD CONSTRAINT saga_state_type_valid
        CHECK (saga_type IN ('registro', 'verificacion_email', 'calificacion',
                             'simulacion', 'actividad', 'anonimizacion', 'curaduria'));

ALTER TABLE event_outbox
    DROP CONSTRAINT event_outbox_event_type_valid;

ALTER TABLE event_outbox
    ADD CONSTRAINT event_outbox_event_type_valid
        CHECK (event_type IN ('user.registered', 'user.email_verified',
                              'learning.quiz_graded', 'user.progress_milestone',
                              'user.activity', 'simulation.executed',
                              'account.anonymized', 'indicator.calendar_alert',
                              'calculator.published'));

COMMIT;
