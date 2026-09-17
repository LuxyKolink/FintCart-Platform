-- Revierte 20260902114500_backfill_body_doc_nulls — y la reversión es NO HACER NADA.
--
-- No es un descuido: esta migración no cambia una forma, rellena un hueco. Deshacerla
-- sería volver a poner `NULL` en las filas que tenían texto, es decir, volver a dejar el
-- invariante roto a propósito. Una migración descendente que empeora los datos no es una
-- reversión, es una regresión con nombre de reversión.
--
-- La forma (la columna `body_doc`, su `CHECK` y su `NOT NULL` futuro) la revierte la
-- migración descendente de `20260902111500`, que es la que la creó.
SELECT 1;
