-- A platform-delivery order is handed to its delivery partner, and the partner
-- had no code to present.
--
-- The only two issuers of a pickup code were the customer (CUS-51, for an order
-- they collect themselves) and the vendor's fallback for a customer who cannot
-- show theirs. Neither describes a rider at the counter: the customer is at
-- home holding a *delivery* code for the door, and the fallback's reasons are
-- all about the customer's phone. So the console asked the shopkeeper for a
-- "customer's collection code" on an order nobody was collecting, and the only
-- way through was a fallback issued for a reason that was not true.
--
-- The partner is now a third issuer. The code is minted for the assignment the
-- partner holds, only once they have marked arrival, and stored on the same
-- column with the same lifetime and attempt limit as the other two, so the shop
-- validates one number wherever it came from (DLP-24, workflow 6.7.6).
ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_pickup_otp_issuer_allowed;
ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_order_pickup_otp_issuer_allowed
    CHECK (pickup_otp_issued_by IS NULL
        OR pickup_otp_issued_by IN ('CUSTOMER', 'VENDOR_FALLBACK', 'PARTNER'));

COMMENT ON COLUMN marketplace.vendor_orders.pickup_otp_issued_by IS
  'Which side minted the live pickup code. CUSTOMER is the default path for an order the customer collects (CUS-51); PARTNER is the default path for a platform delivery, minted by the assigned partner once at the store (DLP-24); VENDOR_FALLBACK is the approved alternative proof for a collector who cannot show a code, and carries its reason on the PICKUP_OTP_ISSUED event.';
