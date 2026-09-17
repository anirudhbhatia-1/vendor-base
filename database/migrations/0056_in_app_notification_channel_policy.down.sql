-- Preferences and their history reference the policy by (kind, channel) with
-- ON DELETE RESTRICT, so anything a person chose for an in-app channel has to
-- go before the policy rows it points at.
DELETE FROM marketplace.notification_preference_events WHERE channel = 'IN_APP';
DELETE FROM marketplace.notification_preferences WHERE channel = 'IN_APP';
DELETE FROM marketplace.notification_channel_policies WHERE channel = 'IN_APP';

ALTER TABLE marketplace.notification_channel_policies
  DROP CONSTRAINT notification_channel_allowed;
ALTER TABLE marketplace.notification_channel_policies
  ADD CONSTRAINT notification_channel_allowed CHECK (channel IN ('PUSH', 'SMS'));
