-- Revierte 20260902121500_financial_indicators.
DROP INDEX IF EXISTS financial_indicators_lookup_idx;
DROP TABLE IF EXISTS financial_indicators;

-- `btree_gist` NO se elimina, por el mismo motivo por el que la migración inicial no
-- elimina `pgcrypto` en su `down`: una extensión es infraestructura de la BASE, no de
-- esta tabla. Nada más la usa hoy, pero soltarla aquí convertiría un `down` de una
-- tabla en un cambio de alcance de base, y una migración posterior que la necesitara
-- tendría que volver a declararla por un motivo que no es el suyo.
