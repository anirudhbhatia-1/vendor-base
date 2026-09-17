DROP INDEX IF EXISTS marketplace.vendor_onboarding_invitation_expiry;
ALTER TABLE marketplace.vendor_onboarding_cases DROP COLUMN IF EXISTS invitation_expires_at;
