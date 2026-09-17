ALTER TABLE marketplace.delivery_assignments
  DROP CONSTRAINT IF EXISTS delivery_assignment_otp_shape,
  DROP CONSTRAINT IF EXISTS delivery_assignment_otp_attempts_bounded,
  DROP CONSTRAINT IF EXISTS delivery_assignment_otp_hash_shape;

ALTER TABLE marketplace.delivery_assignments
  DROP COLUMN IF EXISTS delivery_otp_attempts,
  DROP COLUMN IF EXISTS delivery_otp_expires_at,
  DROP COLUMN IF EXISTS delivery_otp_hash;
