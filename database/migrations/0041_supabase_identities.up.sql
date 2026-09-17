-- Links Supabase Auth users (auth.users.id UUIDs) to marketplace users.
-- Coexists with phone_identities: OTP-authed users still use phone_identities;
-- Supabase-authed users use supabase_identities. A single marketplace user
-- may have both if an admin adds email login later.

CREATE TABLE marketplace.supabase_identities (
  supabase_user_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email LIKE '%@%'),
  data_classification text NOT NULL DEFAULT 'HIGHLY_RESTRICTED',
  retention_class text NOT NULL DEFAULT 'VERIFIED_IDENTITY',
  retention_review_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX supabase_identities_user_unique ON marketplace.supabase_identities(user_id);
CREATE INDEX supabase_identities_email ON marketplace.supabase_identities(email);

-- Allow sessions to originate from Supabase Auth as well.
ALTER TABLE marketplace.sessions DROP CONSTRAINT IF EXISTS session_origin_allowed;
ALTER TABLE marketplace.sessions ADD CONSTRAINT session_origin_allowed
  CHECK (origin_kind IN ('OTP','PASSWORD','SUPABASE'));
ALTER TABLE marketplace.sessions DROP CONSTRAINT IF EXISTS session_origin_consistency;
ALTER TABLE marketplace.sessions ADD CONSTRAINT session_origin_consistency CHECK (
  (origin_kind = 'OTP' AND otp_challenge_id IS NOT NULL)
  OR (origin_kind IN ('PASSWORD','SUPABASE') AND otp_challenge_id IS NULL)
);
