DROP TRIGGER IF EXISTS notification_attempts_append_only ON marketplace.notification_attempts;
DROP FUNCTION IF EXISTS marketplace.protect_notification_attempts();
DROP TABLE IF EXISTS marketplace.in_app_notifications;
DROP TABLE IF EXISTS marketplace.notification_attempts;
DROP TABLE IF EXISTS marketplace.notification_intents;
