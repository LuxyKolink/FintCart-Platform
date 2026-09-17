-- Plantilla del aviso de vencimiento de indicadores (T106, FR-061).
--
-- Igual que en el outbox del Orquestador: la lista de plantillas es CERRADA y ampliarla
-- exige una migración. Es la contrapartida de que un binding sin plantilla entregue
-- mensajes que el consumidor solo puede descartar — una cola que recibe y tira en silencio
-- es indistinguible de una que funciona.

BEGIN;

ALTER TABLE notification_events_queue
    DROP CONSTRAINT notification_events_queue_template_valid;

ALTER TABLE notification_events_queue
    ADD CONSTRAINT notification_events_queue_template_valid
        CHECK (template IN ('verificacion', 'cambio_password', 'alerta_seguridad',
                            'indicator_calendar_alert'));

COMMIT;
