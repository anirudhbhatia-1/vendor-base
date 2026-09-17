DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.sessions WHERE origin_kind = 'SUPABASE') THEN
    RAISE EXCEPTION 'Refusing to roll back: Supabase-origin sessions exist.'
      USING ERRCODE='55000';
  END IF;
END $$;
ALTER TABLE marketplace.sessions DROP CONSTRAINT IF EXISTS session_origin_consistency;
ALTER TABLE marketplace.sessions DROP CONSTRAINT IF EXISTS session_origin_allowed;
ALTER TABLE marketplace.sessions ADD CONSTRAINT session_origin_allowed
  CHECK (origin_kind IN ('OTP','PASSWORD'));
ALTER TABLE marketplace.sessions ADD CONSTRAINT session_origin_consistency CHECK (
  (origin_kind = 'OTP' AND otp_challenge_id IS NOT NULL)
  OR (origin_kind = 'PASSWORD' AND otp_challenge_id IS NULL)
);
DROP TABLE IF EXISTS marketplace.supabase_identities;
