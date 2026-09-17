-- Bind Supabase auth.sessions to first-class marketplace sessions. Supabase owns
-- its access/refresh token material; marketplace owns authorization and
-- revocation state for requests reaching this API.

ALTER TABLE marketplace.sessions
  ADD COLUMN external_supabase_session_id uuid;

ALTER TABLE marketplace.sessions
  ALTER COLUMN access_token_hash DROP NOT NULL,
  ALTER COLUMN access_expires_at DROP NOT NULL,
  ALTER COLUMN refresh_expires_at DROP NOT NULL;

ALTER TABLE marketplace.sessions
  DROP CONSTRAINT IF EXISTS session_origin_consistency;

ALTER TABLE marketplace.sessions
  ADD CONSTRAINT session_origin_consistency CHECK (
    (
      origin_kind = 'OTP'
      AND otp_challenge_id IS NOT NULL
      AND external_supabase_session_id IS NULL
      AND access_token_hash IS NOT NULL
      AND access_expires_at IS NOT NULL
      AND refresh_expires_at IS NOT NULL
    )
    OR (
      origin_kind = 'PASSWORD'
      AND otp_challenge_id IS NULL
      AND external_supabase_session_id IS NULL
      AND access_token_hash IS NOT NULL
      AND access_expires_at IS NOT NULL
      AND refresh_expires_at IS NOT NULL
    )
    OR (
      origin_kind = 'SUPABASE'
      AND otp_challenge_id IS NULL
      AND external_supabase_session_id IS NOT NULL
      AND access_token_hash IS NULL
      AND access_expires_at IS NULL
      AND refresh_expires_at IS NULL
    )
  );

CREATE UNIQUE INDEX sessions_external_supabase_session_unique
  ON marketplace.sessions (external_supabase_session_id)
  WHERE external_supabase_session_id IS NOT NULL;

COMMENT ON COLUMN marketplace.sessions.external_supabase_session_id IS
  'Supabase auth.sessions UUID. Marketplace session_id remains the internal UUIDv7 authorization handle.';
