-- Revierte 20260902111500_article_versions_body_doc.
--
-- Es la reversión íntegra y sin pérdida porque la migración ascendente **no
-- tocó `body`**: el texto plano sigue donde estaba, así que deshacer es soltar
-- la columna nueva y su CHECK. Es exactamente la propiedad que FR-069 exige
-- («sin invalidar sus versiones históricas») y la razón de que este paso sea uno
-- y no dos.
BEGIN;

ALTER TABLE article_versions DROP CONSTRAINT article_versions_body_doc_root;
ALTER TABLE article_versions DROP COLUMN body_doc;

COMMIT;
