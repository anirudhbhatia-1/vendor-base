ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT IF EXISTS vendor_order_pickup_otp_issuer_shape,
  DROP CONSTRAINT IF EXISTS vendor_order_pickup_otp_issuer_allowed;

ALTER TABLE marketplace.vendor_orders
  DROP COLUMN IF EXISTS pickup_otp_issued_by;
