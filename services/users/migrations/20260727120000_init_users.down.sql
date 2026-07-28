-- Revierte 20260727120000_init_users.
BEGIN;

DROP INDEX IF EXISTS inapp_notifications_unread_idx;
DROP INDEX IF EXISTS inapp_notifications_user_created_idx;
DROP INDEX IF EXISTS profiles_email_active_uniq;

DROP TABLE IF EXISTS inapp_notifications;
DROP TABLE IF EXISTS article_views;
DROP TABLE IF EXISTS quiz_best_score;
DROP TABLE IF EXISTS progress;
DROP TABLE IF EXISTS preferences;
DROP TABLE IF EXISTS roles_assignment;
DROP TABLE IF EXISTS profiles;

COMMIT;
