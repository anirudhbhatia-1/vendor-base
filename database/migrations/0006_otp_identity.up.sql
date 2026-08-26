CREATE TABLE marketplace.otp_challenges (
  challenge_id uuid PRIMARY KEY,
  phone_lookup_hash text NOT NULL,
  device_id uuid NOT NULL,
  purpose text NOT NULL,
  request_key text NOT NULL,
  code_hash text NOT NULL,
  status text NOT NULL,
  provider_scenario text NOT NULL,
  provider_reference text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT otp_request_identity UNIQUE (phone_lookup_hash, purpose, request_key),
  CONSTRAINT otp_phone_hash_shape CHECK (phone_lookup_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT otp_purpose_allowed CHECK (purpose IN ('SIGN_IN')),
  CONSTRAINT otp_request_key_shape CHECK (request_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  CONSTRAINT otp_code_hash_shape CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT otp_status_allowed CHECK (status IN
    ('DELIVERED', 'DELAYED', 'FAILED', 'CONSUMED', 'EXPIRED', 'LOCKED')),
  CONSTRAINT otp_provider_scenario_allowed CHECK (provider_scenario IN
    ('success', 'failure', 'delay', 'duplicate_callback')),
  CONSTRAINT otp_attempt_bounds CHECK (max_attempts BETWEEN 1 AND 10
    AND attempt_count BETWEEN 0 AND max_attempts),
  CONSTRAINT otp_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT otp_consumption_shape CHECK (
    (status = 'CONSUMED' AND consumed_at IS NOT NULL)
    OR (status <> 'CONSUMED' AND consumed_at IS NULL)
  )
);

CREATE INDEX otp_challenges_phone_rate
  ON marketplace.otp_challenges (phone_lookup_hash, created_at DESC);

CREATE INDEX otp_challenges_device_rate
  ON marketplace.otp_challenges (device_id, created_at DESC);

CREATE INDEX otp_challenges_expiry
  ON marketplace.otp_challenges (status, expires_at)
  WHERE status IN ('DELIVERED', 'DELAYED');

CREATE TABLE marketplace.otp_protected_test_outbox (
  challenge_id uuid PRIMARY KEY,
  otp_code text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT otp_test_outbox_challenge_fk FOREIGN KEY (challenge_id)
    REFERENCES marketplace.otp_challenges (challenge_id) ON DELETE RESTRICT,
  CONSTRAINT otp_test_code_shape CHECK (otp_code ~ '^[0-9]{6}$')
);

CREATE TABLE marketplace.otp_provider_events (
  provider_event_id text PRIMARY KEY,
  challenge_id uuid NOT NULL,
  outcome text NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT otp_provider_event_challenge_fk FOREIGN KEY (challenge_id)
    REFERENCES marketplace.otp_challenges (challenge_id) ON DELETE RESTRICT,
  CONSTRAINT otp_provider_event_id_shape
    CHECK (provider_event_id ~ '^otp_evt_[A-Za-z0-9_-]{8,96}$'),
  CONSTRAINT otp_provider_outcome_allowed CHECK (outcome IN ('delivered', 'failed', 'delayed'))
);

CREATE INDEX otp_provider_events_challenge
  ON marketplace.otp_provider_events (challenge_id, created_at);

CREATE TABLE marketplace.otp_verification_attempts (
  attempt_id uuid PRIMARY KEY,
  challenge_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  outcome text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT otp_attempt_challenge_fk FOREIGN KEY (challenge_id)
    REFERENCES marketplace.otp_challenges (challenge_id) ON DELETE RESTRICT,
  CONSTRAINT otp_attempt_number_unique UNIQUE (challenge_id, attempt_number),
  CONSTRAINT otp_attempt_number_bounds CHECK (attempt_number BETWEEN 1 AND 10),
  CONSTRAINT otp_attempt_outcome_allowed CHECK (outcome IN ('WRONG', 'VERIFIED', 'EXPIRED'))
);

CREATE INDEX otp_verification_attempts_recent
  ON marketplace.otp_verification_attempts (occurred_at, outcome);

CREATE TRIGGER otp_verification_attempts_append_only
BEFORE UPDATE OR DELETE ON marketplace.otp_verification_attempts
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_configuration_history();

COMMENT ON TABLE marketplace.otp_challenges IS
  'Purpose-scoped short-lived OTP challenges. Phone identifiers and codes are stored only as keyed hashes.';

COMMENT ON TABLE marketplace.otp_protected_test_outbox IS
  'Local synthetic provider outbox. OTP content is available only to the explicit test helper and is deleted on verification or expiry.';

COMMENT ON TABLE marketplace.otp_provider_events IS
  'Deduplicated synthetic provider delivery callbacks with no OTP content.';

COMMENT ON TABLE marketplace.otp_verification_attempts IS
  'Append-only OTP-free verification outcomes for abuse evidence and metrics.';
