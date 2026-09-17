-- The in-app channel had no policy, so nobody could see it or switch it off.
--
-- 0037 made IN_APP a first-class delivery channel: `notification_intents.channels`
-- and `notification_attempts.channel` both accept it, and the customer's inbox
-- reads what it writes. The channel policy table from 0009 was never widened to
-- match, and it is the table the preference model is built on — `getSettings`
-- lists one row per policy, and `notification_preferences` foreign-keys to it.
--
-- In-app messages were still delivered, because the delivery path treats IN_APP
-- as always enabled and needs no provider for it. The defect is the other half:
-- in-app was the one channel a person could neither see in their settings nor
-- turn off, which is exactly what 0009's preference model exists to prevent.
--
-- In-app is the least intrusive channel — a message waiting inside an app the
-- person already opened — so the three operational kinds default it on, matching
-- how PUSH treats the same kinds, and marketing stays consent-gated and off.
-- Making the delivery path honour a person's in-app choice is a code change that
-- accompanies this one; the rows below are what makes that choice expressible.

ALTER TABLE marketplace.notification_channel_policies
  DROP CONSTRAINT notification_channel_allowed;
ALTER TABLE marketplace.notification_channel_policies
  ADD CONSTRAINT notification_channel_allowed CHECK (channel IN ('IN_APP', 'PUSH', 'SMS'));

INSERT INTO marketplace.notification_channel_policies
  (notification_kind, channel, user_controllable, default_enabled, requires_consent_kind, description)
VALUES
  ('SECURITY', 'IN_APP', false, true, NULL, 'Required in-app account security notification'),
  ('ORDER_STATUS', 'IN_APP', false, true, NULL, 'Required in-app order-state notification'),
  ('SUPPORT', 'IN_APP', false, true, NULL, 'Required in-app support-case notification'),
  ('MARKETING', 'IN_APP', true, false, 'MARKETING', 'Optional consent-gated in-app marketing notification')
ON CONFLICT (notification_kind, channel) DO NOTHING;
