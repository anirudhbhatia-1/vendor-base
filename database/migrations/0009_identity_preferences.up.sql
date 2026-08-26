ALTER TABLE marketplace.users
  ADD COLUMN retention_class text NOT NULL DEFAULT 'ACCOUNT_LIFECYCLE',
  ADD COLUMN retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '365 days'),
  ADD CONSTRAINT users_retention_class CHECK (retention_class = 'ACCOUNT_LIFECYCLE');

ALTER TABLE marketplace.phone_identities
  ADD COLUMN data_classification text NOT NULL DEFAULT 'HIGHLY_RESTRICTED',
  ADD COLUMN retention_class text NOT NULL DEFAULT 'VERIFIED_IDENTITY',
  ADD COLUMN retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '365 days'),
  ADD CONSTRAINT phone_identity_classification CHECK (data_classification = 'HIGHLY_RESTRICTED'),
  ADD CONSTRAINT phone_identity_retention_class CHECK (retention_class = 'VERIFIED_IDENTITY');

ALTER TABLE marketplace.devices
  ADD COLUMN data_classification text NOT NULL DEFAULT 'RESTRICTED',
  ADD COLUMN retention_class text NOT NULL DEFAULT 'DEVICE_SECURITY',
  ADD COLUMN retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '180 days'),
  ADD CONSTRAINT device_classification CHECK (data_classification = 'RESTRICTED'),
  ADD CONSTRAINT device_retention_class CHECK (retention_class = 'DEVICE_SECURITY');

ALTER TABLE marketplace.sessions
  ADD COLUMN data_classification text NOT NULL DEFAULT 'HIGHLY_RESTRICTED',
  ADD COLUMN retention_class text NOT NULL DEFAULT 'SESSION_SECURITY',
  ADD COLUMN retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '90 days'),
  ADD CONSTRAINT session_classification CHECK (data_classification = 'HIGHLY_RESTRICTED'),
  ADD CONSTRAINT session_retention_class CHECK (retention_class = 'SESSION_SECURITY');

ALTER TABLE marketplace.otp_challenges
  ADD COLUMN data_classification text NOT NULL DEFAULT 'HIGHLY_RESTRICTED',
  ADD COLUMN retention_class text NOT NULL DEFAULT 'OTP_ABUSE_EVIDENCE',
  ADD COLUMN retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '30 days'),
  ADD CONSTRAINT otp_challenge_classification CHECK (data_classification = 'HIGHLY_RESTRICTED'),
  ADD CONSTRAINT otp_challenge_retention_class CHECK (retention_class = 'OTP_ABUSE_EVIDENCE');

ALTER TABLE marketplace.role_assignments
  ADD COLUMN data_classification text NOT NULL DEFAULT 'RESTRICTED',
  ADD COLUMN retention_class text NOT NULL DEFAULT 'ACCESS_CONTROL',
  ADD COLUMN retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '365 days'),
  ADD CONSTRAINT role_assignment_classification CHECK (data_classification = 'RESTRICTED'),
  ADD CONSTRAINT role_assignment_retention_class CHECK (retention_class = 'ACCESS_CONTROL');

CREATE TABLE marketplace.customer_profiles (
  user_id uuid PRIMARY KEY,
  display_name text,
  language text NOT NULL DEFAULT 'EN',
  state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  data_classification text NOT NULL DEFAULT 'RESTRICTED',
  retention_class text NOT NULL DEFAULT 'CUSTOMER_PROFILE',
  retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '365 days'),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT customer_profile_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT customer_profile_display_name_safe CHECK (display_name IS NULL OR
    (length(display_name) BETWEEN 1 AND 80 AND display_name !~ '[[:cntrl:]]')),
  CONSTRAINT customer_profile_language_allowed CHECK (language IN ('EN', 'HI')),
  CONSTRAINT customer_profile_state_allowed CHECK (state IN ('ACTIVE', 'ANONYMIZED')),
  CONSTRAINT customer_profile_version_positive CHECK (version >= 1),
  CONSTRAINT customer_profile_classification CHECK (data_classification = 'RESTRICTED'),
  CONSTRAINT customer_profile_retention_class CHECK (retention_class = 'CUSTOMER_PROFILE')
);

CREATE TABLE marketplace.consents (
  consent_record_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  consent_kind text NOT NULL,
  consent_version integer NOT NULL,
  policy_version text NOT NULL,
  decision text NOT NULL,
  source text NOT NULL,
  previous_consent_record_id uuid,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  data_classification text NOT NULL DEFAULT 'RESTRICTED',
  retention_class text NOT NULL DEFAULT 'CONSENT_EVIDENCE',
  retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '730 days'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT consent_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT consent_previous_fk FOREIGN KEY (previous_consent_record_id)
    REFERENCES marketplace.consents (consent_record_id) ON DELETE RESTRICT,
  CONSTRAINT consent_kind_allowed CHECK
    (consent_kind IN ('LOCATION', 'MARKETING', 'PRIVACY', 'TERMS')),
  CONSTRAINT consent_version_positive CHECK (consent_version >= 1),
  CONSTRAINT consent_policy_version_shape CHECK (policy_version ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  CONSTRAINT consent_decision_allowed CHECK (decision IN ('GRANTED', 'WITHDRAWN')),
  CONSTRAINT consent_source_allowed CHECK (source IN ('ANDROID', 'CUSTOMER_API', 'CUSTOMER_PWA')),
  CONSTRAINT consent_version_link CHECK (
    (consent_version = 1 AND previous_consent_record_id IS NULL)
    OR (consent_version > 1 AND previous_consent_record_id IS NOT NULL)
  ),
  CONSTRAINT consent_classification CHECK (data_classification = 'RESTRICTED'),
  CONSTRAINT consent_retention_class CHECK (retention_class = 'CONSENT_EVIDENCE'),
  CONSTRAINT consent_version_unique UNIQUE (user_id, consent_kind, consent_version),
  CONSTRAINT consent_request_unique UNIQUE (user_id, consent_kind, request_id)
);

CREATE INDEX consents_current
  ON marketplace.consents (user_id, consent_kind, consent_version DESC);

CREATE TABLE marketplace.notification_channel_policies (
  notification_kind text NOT NULL,
  channel text NOT NULL,
  user_controllable boolean NOT NULL,
  default_enabled boolean NOT NULL,
  requires_consent_kind text,
  description text NOT NULL,
  PRIMARY KEY (notification_kind, channel),
  CONSTRAINT notification_kind_allowed CHECK
    (notification_kind IN ('MARKETING', 'ORDER_STATUS', 'SECURITY', 'SUPPORT')),
  CONSTRAINT notification_channel_allowed CHECK (channel IN ('PUSH', 'SMS')),
  CONSTRAINT notification_policy_consent_allowed CHECK
    (requires_consent_kind IS NULL OR requires_consent_kind = 'MARKETING'),
  CONSTRAINT notification_policy_required_shape CHECK
    (user_controllable OR default_enabled),
  CONSTRAINT notification_policy_description_shape CHECK (length(description) BETWEEN 1 AND 200)
);

INSERT INTO marketplace.notification_channel_policies
  (notification_kind, channel, user_controllable, default_enabled, requires_consent_kind, description)
VALUES
  ('SECURITY', 'SMS', false, true, NULL, 'Required account security notification'),
  ('SECURITY', 'PUSH', true, true, NULL, 'Optional additional account security notification'),
  ('ORDER_STATUS', 'SMS', false, true, NULL, 'Required order-state notification'),
  ('ORDER_STATUS', 'PUSH', true, true, NULL, 'Optional additional order-state notification'),
  ('SUPPORT', 'PUSH', false, true, NULL, 'Required active support-case notification'),
  ('SUPPORT', 'SMS', true, false, NULL, 'Optional support-case SMS notification'),
  ('MARKETING', 'PUSH', true, false, 'MARKETING', 'Optional consent-gated marketing notification'),
  ('MARKETING', 'SMS', true, false, 'MARKETING', 'Optional consent-gated marketing SMS');

CREATE TABLE marketplace.notification_preferences (
  user_id uuid NOT NULL,
  notification_kind text NOT NULL,
  channel text NOT NULL,
  enabled boolean NOT NULL,
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  data_classification text NOT NULL DEFAULT 'INTERNAL',
  retention_class text NOT NULL DEFAULT 'COMMUNICATION_PREFERENCE',
  retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '365 days'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, notification_kind, channel),
  CONSTRAINT notification_preference_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT notification_preference_policy_fk FOREIGN KEY (notification_kind, channel)
    REFERENCES marketplace.notification_channel_policies (notification_kind, channel) ON DELETE RESTRICT,
  CONSTRAINT notification_preference_version_positive CHECK (version >= 1),
  CONSTRAINT notification_preference_classification CHECK (data_classification = 'INTERNAL'),
  CONSTRAINT notification_preference_retention_class CHECK
    (retention_class = 'COMMUNICATION_PREFERENCE')
);

CREATE TABLE marketplace.notification_preference_events (
  event_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  notification_kind text NOT NULL,
  channel text NOT NULL,
  enabled boolean NOT NULL,
  preference_version integer NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT notification_preference_event_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT notification_preference_event_policy_fk FOREIGN KEY (notification_kind, channel)
    REFERENCES marketplace.notification_channel_policies (notification_kind, channel) ON DELETE RESTRICT,
  CONSTRAINT notification_preference_event_version_positive CHECK (preference_version >= 1),
  CONSTRAINT notification_preference_event_unique UNIQUE
    (user_id, notification_kind, channel, preference_version)
);

CREATE INDEX notification_preference_events_history
  ON marketplace.notification_preference_events
    (user_id, notification_kind, channel, preference_version);

CREATE FUNCTION marketplace.enforce_required_notification_channel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  controllable boolean;
BEGIN
  SELECT user_controllable INTO controllable
    FROM marketplace.notification_channel_policies
   WHERE notification_kind = NEW.notification_kind AND channel = NEW.channel;
  IF controllable IS NULL THEN
    RAISE EXCEPTION 'notification policy does not exist' USING ERRCODE = '23503';
  END IF;
  IF NOT controllable AND NOT NEW.enabled THEN
    RAISE EXCEPTION 'required notification channel cannot be disabled' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_preference_required_channel
BEFORE INSERT OR UPDATE OF notification_kind, channel, enabled
ON marketplace.notification_preferences
FOR EACH ROW
EXECUTE FUNCTION marketplace.enforce_required_notification_channel();

CREATE TRIGGER consents_append_only
BEFORE UPDATE OR DELETE ON marketplace.consents
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_configuration_history();

CREATE TRIGGER notification_preference_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.notification_preference_events
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_configuration_history();

COMMENT ON TABLE marketplace.customer_profiles IS
  'Minimal optional customer profile with English/Hindi preference and optimistic version.';
COMMENT ON TABLE marketplace.consents IS
  'Append-only, policy-versioned customer consent evidence.';
COMMENT ON TABLE marketplace.notification_channel_policies IS
  'Reviewed channel defaults and required-notification controls.';
COMMENT ON TABLE marketplace.notification_preferences IS
  'Current customer-controlled channel overrides; required channels cannot be disabled.';
