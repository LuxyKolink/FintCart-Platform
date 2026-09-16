-- Una simulación puede venir de una calculadora definida por un USUARIO (research D-26).
--
-- `calc_type` se declaró NOT NULL con los cinco tipos nativos de FR-019, y una calculadora
-- de usuario no tiene ninguno. Hasta ahora eso hacía que insertar su simulación fuera
-- IMPOSIBLE —no lo detectó una prueba, lo encontró T091 al ir a implementarlo—, y por eso
-- `Compute` rechazaba `calculator_id` en lugar de calcular: un cliente que pedía una
-- calculadora concreta recibía el resultado de otra sin que nada se lo dijera.
--
-- Se amplía el vocabulario con un sexto valor en vez de anular la columna. `'usuario'` no
-- es un centinela para salir del paso: dice algo cierto —la definición la escribió un
-- usuario— y mantiene NOT NULL, de modo que ni `SimulationRow` ni `ListHistory` ni ningún
-- consumidor tienen que aprender a leer un nulo.
--
-- La alternativa (columna anulable) es más honesta con los datos y se descartó por lo que
-- obliga a decidir en la RESPUESTA: `ListHistory` tendría que devolver
-- CALC_TYPE_UNSPECIFIED para esas filas, que es el mismo valor que en la PETICIÓN significa
-- «el cliente olvidó el campo» y por eso es un error. Dos significados para un valor, a
-- cambio de una honestidad que `calculator_id` ya aporta — la entrada del historial lo
-- lleva desde la migración de T020.

BEGIN;

ALTER TABLE simulations DROP CONSTRAINT simulations_calc_type_valid;

ALTER TABLE simulations
    ADD CONSTRAINT simulations_calc_type_valid
        CHECK (calc_type IN (
            'ahorro',
            'credito',
            'presupuesto',
            'inversion',
            'colombia_especifica',
            'usuario'
        ));

COMMIT;
