-- D-15 requires "an expiring one-use invitation". One-use was enforced -- a claim is
-- refused unless the case is still INVITED, and the expected-version check refuses a
-- replay again -- but nothing expired.
--
-- That matters because the applicant is optional. Inviting a vendor who has not signed
-- up yet is the ordinary case, and then the reference is the only thing gating the
-- claim: `claimInvitation` binds to `applicant_user_id` only when the case already has
-- one. A reference is admin-chosen text such as INV-JAIPUR-0001, so a leaked or guessed
-- one stayed claimable forever, and claiming it means becoming the applicant for that
-- vendor -- which on approval grants VENDOR_OWNER membership.
--
-- Nullable, because cases created before this migration have no expiry and must remain
-- claimable rather than being locked out by a backfilled date.

ALTER TABLE marketplace.vendor_onboarding_cases
  ADD COLUMN invitation_expires_at timestamptz;

COMMENT ON COLUMN marketplace.vendor_onboarding_cases.invitation_expires_at IS
  'When an INVITATION entry stops being claimable. Null means no expiry was recorded, '
  'which applies only to cases created before migration 0068.';

CREATE INDEX vendor_onboarding_invitation_expiry
  ON marketplace.vendor_onboarding_cases (invitation_expires_at)
  WHERE lifecycle_state = 'INVITED';
