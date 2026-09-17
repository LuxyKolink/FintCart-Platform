-- Reversión de la plantilla del aviso de indicadores (T106).
--
-- Se borran las filas de esa plantilla antes de cerrar la lista, por el mismo motivo que en
-- el `down` del Orquestador: el `CHECK` valida las filas existentes al añadirse, así que
-- dejarlas haría fallar la marcha atrás. Y una fila con una plantilla que ya no existe es un
-- correo que nadie puede renderizar. `notification_states` —el histórico de entregas— no se
-- toca: es append-only y prueba lo que se entregó cuando la plantilla existía.

BEGIN;

DELETE FROM notification_events_queue WHERE template = 'indicator_calendar_alert';

ALTER TABLE notification_events_queue
    DROP CONSTRAINT notification_events_queue_template_valid;

ALTER TABLE notification_events_queue
    ADD CONSTRAINT notification_events_queue_template_valid
        CHECK (template IN ('verificacion', 'cambio_password', 'alerta_seguridad'));

COMMIT;
