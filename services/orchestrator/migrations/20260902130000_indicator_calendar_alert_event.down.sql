-- Reversión de la ampliación de `event_outbox_event_type_valid` (T105).
--
-- ## Por qué BORRA las filas de ese tipo antes de volver a cerrar el CHECK
--
-- Cerrar la lista con filas del tipo retirado ya en la tabla no es posible: el `CHECK`
-- valida las filas existentes al añadirse, así que la migración fallaría con un error de
-- violación de restricción y la marcha atrás quedaría a medias. Y dejar esas filas tampoco
-- sería correcto: si el tipo deja de existir, una fila que lo cite es un evento que nadie
-- va a saber interpretar —el servicio de Notificación no tiene plantilla para él y la
-- descartaría—, es decir, un mensaje encolado para nadie.
--
-- Se borran TODAS, publicadas o no. Es una reversión destructiva y por eso está escrita
-- aquí, en la migración, y no escondida en un `DELETE` de mantenimiento: quien deshace esta
-- ampliación está diciendo que el aviso de indicadores no existe en su despliegue, y con él
-- desaparece su cola. Ninguna otra tabla queda afectada: el aviso no escribe nada más, y
-- los indicadores viven en el Simulador.

BEGIN;

DELETE FROM event_outbox WHERE event_type = 'indicator.calendar_alert';

ALTER TABLE event_outbox
    DROP CONSTRAINT event_outbox_event_type_valid;

ALTER TABLE event_outbox
    ADD CONSTRAINT event_outbox_event_type_valid
        CHECK (event_type IN ('user.registered', 'user.email_verified',
                              'learning.quiz_graded', 'user.progress_milestone',
                              'user.activity', 'simulation.executed',
                              'account.anonymized'));

COMMIT;
