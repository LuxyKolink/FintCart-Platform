-- Revierte 20260727120000_init_learning.
BEGIN;

-- La FK circular articles.current_version_id → article_versions debe soltarse
-- antes de poder eliminar las tablas.
ALTER TABLE IF EXISTS articles DROP CONSTRAINT IF EXISTS articles_current_version_fk;

DROP INDEX IF EXISTS quiz_attempts_user_quiz_idx;
DROP INDEX IF EXISTS questions_quiz_idx;
DROP INDEX IF EXISTS quizzes_article_idx;
DROP INDEX IF EXISTS articles_category_idx;
DROP INDEX IF EXISTS article_versions_in_review_idx;
DROP INDEX IF EXISTS article_versions_published_idx;

DROP TABLE IF EXISTS article_stats;
DROP TABLE IF EXISTS quiz_attempts;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS quizzes;
DROP TABLE IF EXISTS article_versions;
DROP TABLE IF EXISTS articles;

COMMIT;
