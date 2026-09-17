-- Revierte el tipo de saga y el evento de la curaduría (T115).
--
-- Las filas de `event_outbox` con el tipo que desaparece se borran antes de rehacer el
-- `CHECK`, porque el `ALTER` falla si alguna lo incumpliera. Borrar un evento PENDIENTE de
-- publicar es una pérdida: significa que la aprobación ocurrió y su rastro de auditoría no. Se
-- hace igualmente porque el `down` deja el esquema en el estado anterior, en el que ese evento
-- no puede existir, y porque un `down` que se negara a correr por las filas que él mismo
-- invalida es un `down` que no sirve para volver atrás.
--
-- A las sagas de curaduría NO se les borra nada: `saga_state_type_valid` es un `CHECK` sobre
-- filas que ya existen, y borrar sagas a medias destruiría estado que quizá haya que reanudar.
-- Si hubiera alguna, el `ALTER` fallará y el motivo se leerá en el error.

BEGIN;

DELETE FROM event_outbox WHERE event_type = 'calculator.published';

ALTER TABLE event_outbox
    DROP CONSTRAINT event_outbox_event_type_valid;

ALTER TABLE event_outbox
    ADD CONSTRAINT event_outbox_event_type_valid
        CHECK (event_type IN ('user.registered', 'user.email_verified',
                              'learning.quiz_graded', 'user.progress_milestone',
                              'user.activity', 'simulation.executed',
                              'account.anonymized',
                              'indicator.calendar_alert'));

ALTER TABLE saga_state
    DROP CONSTRAINT saga_state_type_valid;

ALTER TABLE saga_state
    ADD CONSTRAINT saga_state_type_valid
        CHECK (saga_type IN ('registro', 'verificacion_email', 'calificacion',
                             'simulacion', 'actividad', 'anonimizacion'));

COMMIT;
