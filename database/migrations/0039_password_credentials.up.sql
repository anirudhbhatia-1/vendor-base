-- Password credentials table for admin-provisioned users.
-- Passwords are hashed with Node's built-in scrypt (N=16384, r=8, p=1, keylen=64).
-- Login attempts are rate-limited per phone_lookup_hash via password_verification_attempts.

CREATE TABLE marketplace.password_credentials (
  user_id uuid PRIMARY KEY REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  algorithm text NOT NULL CHECK (algorithm = 'scrypt'),
  parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters) = 'object'),
  hash bytea NOT NULL CHECK (octet_length(hash) BETWEEN 32 AND 128),
  salt bytea NOT NULL CHECK (octet_length(salt) BETWEEN 16 AND 64),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  set_by_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  data_classification text NOT NULL DEFAULT 'HIGHLY_RESTRICTED',
  retention_class text NOT NULL DEFAULT 'ACCESS_CONTROL',
  retention_review_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX password_credentials_set_by ON marketplace.password_credentials(set_by_user_id, updated_at);

CREATE TABLE marketplace.password_verification_attempts (
  attempt_id uuid PRIMARY KEY,
  phone_lookup_hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS','INVALID_PASSWORD','USER_NOT_FOUND','RATE_LIMITED')),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX password_verification_attempts_rate
  ON marketplace.password_verification_attempts(phone_lookup_hash, attempted_at DESC);

-- Append-only audit trail for password lifecycle events (set, rotated, disabled).
CREATE TABLE marketplace.password_credential_events (
  event_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('SET','ROTATED','DISABLED')),
  resulting_version integer NOT NULL CHECK (resulting_version >= 1),
  actor_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(user_id, resulting_version)
);

CREATE INDEX password_credential_events_history
  ON marketplace.password_credential_events(user_id, occurred_at DESC);

CREATE FUNCTION marketplace.protect_password_credential_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'password credential events are append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER password_credential_events_append_only
  BEFORE UPDATE OR DELETE ON marketplace.password_credential_events
  FOR EACH ROW EXECUTE FUNCTION marketplace.protect_password_credential_events();

CREATE FUNCTION marketplace.protect_password_verification_attempts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'password verification attempts are append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER password_verification_attempts_append_only
  BEFORE UPDATE OR DELETE ON marketplace.password_verification_attempts
  FOR EACH ROW EXECUTE FUNCTION marketplace.protect_password_verification_attempts();

-- Session table: allow password-origin sessions alongside OTP-origin sessions.
-- otp_challenge_id becomes nullable when origin_kind='PASSWORD'; a check enforces
-- consistency so an OTP-origin session cannot omit its challenge id.
ALTER TABLE marketplace.sessions ADD COLUMN origin_kind text NOT NULL DEFAULT 'OTP';
ALTER TABLE marketplace.sessions ADD CONSTRAINT session_origin_allowed
  CHECK (origin_kind IN ('OTP','PASSWORD'));
ALTER TABLE marketplace.sessions ADD CONSTRAINT session_origin_consistency CHECK (
  (origin_kind = 'OTP' AND otp_challenge_id IS NOT NULL)
  OR (origin_kind = 'PASSWORD' AND otp_challenge_id IS NULL)
);
ALTER TABLE marketplace.sessions ALTER COLUMN otp_challenge_id DROP NOT NULL;

-- Capabilities so admins can provision vendors and partners with initial credentials.
INSERT INTO marketplace.capabilities(capability_key,actor_kind,resource_rule,description)
VALUES
  ('admin.onboarding.vendor.provision','ADMIN','ADMIN_SCOPE','Provision a vendor account with initial login credentials'),
  ('admin.onboarding.partner.provision','ADMIN','ADMIN_SCOPE','Provision a delivery partner account with initial login credentials')
ON CONFLICT DO NOTHING;

INSERT INTO marketplace.role_capabilities(role_key,capability_key)
VALUES
  ('SUPPORT_AGENT','admin.onboarding.vendor.provision'),
  ('SUPPORT_AGENT','admin.onboarding.partner.provision'),
  ('CONFIG_APPROVER','admin.onboarding.vendor.provision'),
  ('CONFIG_APPROVER','admin.onboarding.partner.provision')
ON CONFLICT DO NOTHING;
