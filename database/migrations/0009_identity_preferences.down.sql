DROP TRIGGER IF EXISTS notification_preference_events_append_only
  ON marketplace.notification_preference_events;
DROP TRIGGER IF EXISTS consents_append_only ON marketplace.consents;
DROP TRIGGER IF EXISTS notification_preference_required_channel
  ON marketplace.notification_preferences;
DROP FUNCTION IF EXISTS marketplace.enforce_required_notification_channel();
DROP TABLE IF EXISTS marketplace.notification_preference_events;
DROP TABLE IF EXISTS marketplace.notification_preferences;
DROP TABLE IF EXISTS marketplace.notification_channel_policies;
DROP TABLE IF EXISTS marketplace.consents;
DROP TABLE IF EXISTS marketplace.customer_profiles;

ALTER TABLE marketplace.role_assignments
  DROP CONSTRAINT IF EXISTS role_assignment_retention_class,
  DROP CONSTRAINT IF EXISTS role_assignment_classification,
  DROP COLUMN IF EXISTS retention_review_at,
  DROP COLUMN IF EXISTS retention_class,
  DROP COLUMN IF EXISTS data_classification;
ALTER TABLE marketplace.otp_challenges
  DROP CONSTRAINT IF EXISTS otp_challenge_retention_class,
  DROP CONSTRAINT IF EXISTS otp_challenge_classification,
  DROP COLUMN IF EXISTS retention_review_at,
  DROP COLUMN IF EXISTS retention_class,
  DROP COLUMN IF EXISTS data_classification;
ALTER TABLE marketplace.sessions
  DROP CONSTRAINT IF EXISTS session_retention_class,
  DROP CONSTRAINT IF EXISTS session_classification,
  DROP COLUMN IF EXISTS retention_review_at,
  DROP COLUMN IF EXISTS retention_class,
  DROP COLUMN IF EXISTS data_classification;
ALTER TABLE marketplace.devices
  DROP CONSTRAINT IF EXISTS device_retention_class,
  DROP CONSTRAINT IF EXISTS device_classification,
  DROP COLUMN IF EXISTS retention_review_at,
  DROP COLUMN IF EXISTS retention_class,
  DROP COLUMN IF EXISTS data_classification;
ALTER TABLE marketplace.phone_identities
  DROP CONSTRAINT IF EXISTS phone_identity_retention_class,
  DROP CONSTRAINT IF EXISTS phone_identity_classification,
  DROP COLUMN IF EXISTS retention_review_at,
  DROP COLUMN IF EXISTS retention_class,
  DROP COLUMN IF EXISTS data_classification;
ALTER TABLE marketplace.users
  DROP CONSTRAINT IF EXISTS users_retention_class,
  DROP COLUMN IF EXISTS retention_review_at,
  DROP COLUMN IF EXISTS retention_class;
