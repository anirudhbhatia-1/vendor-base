CREATE TABLE marketplace.users (
  user_id uuid PRIMARY KEY,
  state text NOT NULL DEFAULT 'ACTIVE',
  data_classification text NOT NULL DEFAULT 'RESTRICTED',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT user_state_allowed CHECK (state IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT user_classification_allowed CHECK (data_classification = 'RESTRICTED')
);

CREATE TABLE marketplace.phone_identities (
  phone_identity_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  phone_lookup_hash text NOT NULL UNIQUE,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT phone_identity_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT phone_identity_hash_shape CHECK (phone_lookup_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX phone_identities_user ON marketplace.phone_identities (user_id);

CREATE TABLE marketplace.devices (
  device_registration_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  client_device_id uuid NOT NULL,
  platform text NOT NULL,
  device_label text,
  notification_token_hash text,
  notification_state text NOT NULL DEFAULT 'NONE',
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT device_identity UNIQUE (user_id, client_device_id),
  CONSTRAINT device_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT device_platform_allowed CHECK (platform IN ('WEB', 'ANDROID')),
  CONSTRAINT device_label_safe CHECK (device_label IS NULL OR
    (length(device_label) BETWEEN 1 AND 80 AND device_label !~ '[[:cntrl:]]')),
  CONSTRAINT device_notification_hash_shape CHECK
    (notification_token_hash IS NULL OR notification_token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT device_notification_state_allowed CHECK
    (notification_state IN ('NONE', 'ACTIVE', 'REVOKED')),
  CONSTRAINT device_notification_shape CHECK (
    (notification_state = 'ACTIVE' AND notification_token_hash IS NOT NULL)
    OR (notification_state <> 'ACTIVE' AND notification_token_hash IS NULL)
  )
);

CREATE INDEX devices_user_activity
  ON marketplace.devices (user_id, last_seen_at DESC, device_registration_id);

CREATE TABLE marketplace.sessions (
  session_id uuid PRIMARY KEY,
  token_family_id uuid NOT NULL,
  user_id uuid NOT NULL,
  device_registration_id uuid NOT NULL,
  otp_challenge_id uuid NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  access_token_hash text NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT session_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT session_device_fk FOREIGN KEY (device_registration_id)
    REFERENCES marketplace.devices (device_registration_id) ON DELETE RESTRICT,
  CONSTRAINT session_otp_challenge_fk FOREIGN KEY (otp_challenge_id)
    REFERENCES marketplace.otp_challenges (challenge_id) ON DELETE RESTRICT,
  CONSTRAINT session_state_allowed CHECK (state IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  CONSTRAINT session_version_positive CHECK (version >= 1),
  CONSTRAINT session_access_hash_shape CHECK (access_token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT session_expiry_order CHECK
    (access_expires_at > created_at AND refresh_expires_at > access_expires_at),
  CONSTRAINT session_revocation_shape CHECK (
    (state = 'ACTIVE' AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (state <> 'ACTIVE' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  ),
  CONSTRAINT session_revoke_reason_shape CHECK
    (revoke_reason IS NULL OR revoke_reason ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

CREATE INDEX sessions_user_state
  ON marketplace.sessions (user_id, state, updated_at DESC, session_id);

CREATE INDEX sessions_device_state
  ON marketplace.sessions (device_registration_id, state, updated_at DESC);

CREATE TABLE marketplace.session_refresh_tokens (
  refresh_token_id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE',
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT refresh_token_session_fk FOREIGN KEY (session_id)
    REFERENCES marketplace.sessions (session_id) ON DELETE RESTRICT,
  CONSTRAINT refresh_token_hash_shape CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT refresh_token_status_allowed CHECK (status IN ('ACTIVE', 'ROTATED', 'REVOKED')),
  CONSTRAINT refresh_token_status_shape CHECK (
    (status = 'ACTIVE' AND rotated_at IS NULL AND revoked_at IS NULL)
    OR (status = 'ROTATED' AND rotated_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT refresh_token_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX one_active_refresh_token_per_session
  ON marketplace.session_refresh_tokens (session_id)
  WHERE status = 'ACTIVE';

CREATE INDEX refresh_tokens_session_history
  ON marketplace.session_refresh_tokens (session_id, created_at, refresh_token_id);

CREATE TABLE marketplace.session_events (
  event_id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  session_version integer NOT NULL,
  event_type text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT session_event_session_fk FOREIGN KEY (session_id)
    REFERENCES marketplace.sessions (session_id) ON DELETE RESTRICT,
  CONSTRAINT session_event_version_positive CHECK (session_version >= 1),
  CONSTRAINT session_event_type_allowed CHECK (event_type IN
    ('CREATED', 'REFRESHED', 'REVOKED', 'REPLAY_DETECTED', 'EXPIRED')),
  CONSTRAINT session_event_unique UNIQUE (session_id, session_version, event_type)
);

CREATE INDEX session_events_history
  ON marketplace.session_events (session_id, occurred_at, event_id);

CREATE TRIGGER session_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.session_events
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_configuration_history();

COMMENT ON TABLE marketplace.users IS
  'Minimal identity principals created from verified fictional phone identities; roles begin in Phase 4.3.';

COMMENT ON TABLE marketplace.phone_identities IS
  'Verified keyed phone lookups. Raw phone identifiers are never persisted.';

COMMENT ON TABLE marketplace.devices IS
  'Safe per-user device registrations with hashed notification tokens.';

COMMENT ON TABLE marketplace.sessions IS
  'Opaque hashed access sessions with bounded lifetime and explicit revocation state.';

COMMENT ON TABLE marketplace.session_refresh_tokens IS
  'Hashed rotating refresh-token history used to detect token replay.';

COMMENT ON TABLE marketplace.session_events IS
  'Append-only request-correlated session lifecycle evidence without credentials.';
