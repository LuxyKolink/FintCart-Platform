-- Revierte 20260902120000_calculators.
--
-- El orden importa: `calculator_definitions` referencia `calculators`, así que se
-- elimina primero. El `CASCADE` de la FK lo haría igualmente, pero invertir el orden
-- dejaría el DROP dependiendo de un detalle de la FK en vez de ser explícito.
DROP TABLE IF EXISTS calculator_definitions;
DROP TABLE IF EXISTS calculators;
