-- Revierte 20260902124500_simulations_user_calculator_type.
--
-- Revertir D-26 solo tiene sentido mientras no exista ninguna simulación de calculadora de
-- usuario: en cuanto exista una, no hay ningún valor del vocabulario anterior que la
-- represente, y volver atrás la dejaría sin tipo.
--
-- Por eso se COMPRUEBA antes en lugar de dejar que el ALTER falle solo. La restricción sí
-- fallaría —«violates check constraint simulations_calc_type_valid»—, pero ese mensaje no
-- dice cuántas filas lo impiden ni qué hacer, y quien revierte se queda mirando una
-- violación de integridad sin saber de dónde sale.
--
-- NO se eliminan las filas para que la reversión pase. El historial es del usuario y
-- explicarlo es FR-050; borrarlo para que una migración cuadre sería destruir el dato para
-- salvar el esquema.

DO $$
DECLARE
    pendientes BIGINT;
BEGIN
    SELECT count(*) INTO pendientes FROM simulations WHERE calc_type = 'usuario';

    IF pendientes > 0 THEN
        RAISE EXCEPTION
            'no se puede revertir D-26: % simulaciones se hicieron con calculadoras de '
            'usuario y ningun tipo anterior las representa. Exportarlas o eliminarlas antes '
            'de revertir.', pendientes;
    END IF;
END
$$;

ALTER TABLE simulations DROP CONSTRAINT simulations_calc_type_valid;

ALTER TABLE simulations
    ADD CONSTRAINT simulations_calc_type_valid
        CHECK (calc_type IN (
            'ahorro',
            'credito',
            'presupuesto',
            'inversion',
            'colombia_especifica'
        ));
