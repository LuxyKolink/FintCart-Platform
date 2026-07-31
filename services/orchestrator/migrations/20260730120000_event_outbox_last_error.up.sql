-- Orquestador — causa del último intento fallido de publicación.
--
-- `event_outbox.attempts` ya contaba los fallos, pero un contador sin causa solo
-- dice CUÁNTAS veces falló un evento, no por qué. Y la diferencia decide la
-- respuesta operativa: un `connection refused` es el broker caído y se arregla
-- solo, mientras que un `NOT_FOUND - no exchange 'fintcart.events'` es una
-- topología que nunca se declaró y no va a mejorar reintentando.
--
-- La columna es nullable: un evento que aún no ha fallado nunca no tiene causa que
-- registrar, y un DEFAULT '' haría indistinguible «sin fallos» de «falló sin
-- mensaje».

BEGIN;

ALTER TABLE event_outbox ADD COLUMN last_error TEXT;

COMMENT ON COLUMN event_outbox.last_error IS
    'Causa del último intento fallido de publicación. NULL mientras no haya fallado. Se lee junto con attempts para distinguir un fallo transitorio de uno sistemático.';

COMMIT;
