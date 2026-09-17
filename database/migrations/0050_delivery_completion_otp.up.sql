-- A delivery completes on a customer OTP, not on a self-supplied reference.
--
-- `deliver()` accepted any `proof_reference` string the partner's own client
-- produced, and the partner PWA generated one from the clock —
-- `SYNTH-PROOF-DELIVERY-<timestamp>`. Nothing in the completion path involved
-- the customer at all, so an order could be marked delivered without the
-- partner ever reaching the door. DLP-30 and CUS-56 both make a fresh,
-- server-validated customer OTP the default completion proof, and DLP-31 gates
-- every alternative behind approvals that have not been granted.
--
-- The columns and controls mirror the vendor pickup OTP added in 0026 — the
-- same hashing, expiry and attempt-limiting — rather than inventing a second
-- mechanism for the same job.

ALTER TABLE marketplace.delivery_assignments
  ADD COLUMN delivery_otp_hash text,
  ADD COLUMN delivery_otp_expires_at timestamptz,
  ADD COLUMN delivery_otp_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE marketplace.delivery_assignments
  ADD CONSTRAINT delivery_assignment_otp_hash_shape
    CHECK (delivery_otp_hash IS NULL OR delivery_otp_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT delivery_assignment_otp_attempts_bounded
    CHECK (delivery_otp_attempts BETWEEN 0 AND 5),
  -- The hash and its expiry are meaningless apart, so they arrive and leave
  -- together.
  ADD CONSTRAINT delivery_assignment_otp_shape
    CHECK ((delivery_otp_hash IS NULL AND delivery_otp_expires_at IS NULL)
        OR (delivery_otp_hash IS NOT NULL AND delivery_otp_expires_at IS NOT NULL));

COMMENT ON COLUMN marketplace.delivery_assignments.delivery_otp_hash IS
  'SHA-256 of the six-digit code shown to the customer. The plaintext is returned once, to the customer, and never stored or logged (SEC-09).';
