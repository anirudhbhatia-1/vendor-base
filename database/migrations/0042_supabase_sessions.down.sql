DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM marketplace.sessions
     WHERE external_supabase_session_id IS NOT NULL OR origin_kind = 'SUPABASE'
  ) THEN
    RAISE EXCEPTION 'Refusing to roll back: bound Supabase sessions exist.'
      USING ERRCODE='55000';
  END IF;
END $$;

DROP INDEX IF EXISTS marketplace.sessions_external_supabase_session_unique;

ALTER TABLE marketplace.sessions
  DROP CONSTRAINT IF EXISTS session_origin_consistency;

ALTER TABLE marketplace.sessions
  ALTER COLUMN access_token_hash SET NOT NULL,
  ALTER COLUMN access_expires_at SET NOT NULL,
  ALTER COLUMN refresh_expires_at SET NOT NULL;

ALTER TABLE marketplace.sessions
  DROP COLUMN IF EXISTS external_supabase_session_id;

ALTER TABLE marketplace.sessions
  ADD CONSTRAINT session_origin_consistency CHECK (
    (origin_kind = 'OTP' AND otp_challenge_id IS NOT NULL)
    OR (origin_kind IN ('PASSWORD','SUPABASE') AND otp_challenge_id IS NULL)
  );
