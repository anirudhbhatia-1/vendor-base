-- Password-origin sessions cannot be represented by the old (OTP-only) schema.
-- Rolling back this migration when password sessions exist would silently
-- destroy audit evidence, so refuse the rollback and require the operator to
-- revoke password sessions first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.sessions WHERE origin_kind = 'PASSWORD') THEN
    RAISE EXCEPTION 'Refusing to roll back: password-origin sessions exist. Revoke them first.'
      USING ERRCODE='55000';
  END IF;
END $$;
ALTER TABLE marketplace.sessions DROP CONSTRAINT IF EXISTS session_origin_consistency;
ALTER TABLE marketplace.sessions DROP CONSTRAINT IF EXISTS session_origin_allowed;
ALTER TABLE marketplace.sessions DROP COLUMN IF EXISTS origin_kind;
ALTER TABLE marketplace.sessions ALTER COLUMN otp_challenge_id SET NOT NULL;

DELETE FROM marketplace.role_capabilities
  WHERE capability_key IN ('admin.onboarding.vendor.provision','admin.onboarding.partner.provision');
DELETE FROM marketplace.capabilities
  WHERE capability_key IN ('admin.onboarding.vendor.provision','admin.onboarding.partner.provision');
DROP TRIGGER IF EXISTS password_verification_attempts_append_only ON marketplace.password_verification_attempts;
DROP FUNCTION IF EXISTS marketplace.protect_password_verification_attempts();
DROP TRIGGER IF EXISTS password_credential_events_append_only ON marketplace.password_credential_events;
DROP FUNCTION IF EXISTS marketplace.protect_password_credential_events();
DROP TABLE IF EXISTS marketplace.password_credential_events;
DROP TABLE IF EXISTS marketplace.password_verification_attempts;
DROP TABLE IF EXISTS marketplace.password_credentials;
