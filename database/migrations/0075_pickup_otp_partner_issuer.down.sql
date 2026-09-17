-- A live partner-issued code cannot survive the narrower constraint. Clearing
-- it is the same as letting it expire: the partner mints another on demand.
UPDATE marketplace.vendor_orders
   SET pickup_otp_hash = NULL, pickup_otp_expires_at = NULL, pickup_otp_attempts = 0,
       pickup_otp_issued_by = NULL
 WHERE pickup_otp_issued_by = 'PARTNER';

ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_pickup_otp_issuer_allowed;
ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_order_pickup_otp_issuer_allowed
    CHECK (pickup_otp_issued_by IS NULL
        OR pickup_otp_issued_by IN ('CUSTOMER', 'VENDOR_FALLBACK'));

COMMENT ON COLUMN marketplace.vendor_orders.pickup_otp_issued_by IS
  'Which side minted the live pickup code. CUSTOMER is the default path (CUS-51); VENDOR_FALLBACK is the approved alternative proof for a customer who cannot show a code, and carries its reason on the PICKUP_OTP_ISSUED event.';
