DELETE FROM marketplace.role_capabilities WHERE capability_key IN
  ('vendor.order.fulfil','customer.order.decide','customer.order.read',
   'customer.order.rate','customer.support.open');
DELETE FROM marketplace.capabilities WHERE capability_key IN
  ('vendor.order.fulfil','customer.order.decide','customer.order.read',
   'customer.order.rate','customer.support.open');

DROP TABLE IF EXISTS marketplace.support_cases;
DROP TABLE IF EXISTS marketplace.vendor_order_ratings;
DROP TRIGGER IF EXISTS vendor_order_events_append_only ON marketplace.vendor_order_events;
DROP FUNCTION IF EXISTS marketplace.protect_vendor_order_history();
DROP TABLE IF EXISTS marketplace.vendor_order_events;
DROP TABLE IF EXISTS marketplace.vendor_order_customer_decisions;
DROP TABLE IF EXISTS marketplace.vendor_order_line_picks;

DROP INDEX IF EXISTS marketplace.vendor_orders_pending;
ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT IF EXISTS vendor_order_accepted_after_placed,
  DROP CONSTRAINT IF EXISTS vendor_order_pickup_completes_once,
  DROP CONSTRAINT IF EXISTS vendor_order_ready_snapshot_shape,
  DROP CONSTRAINT IF EXISTS vendor_order_pickup_otp_shape,
  DROP CONSTRAINT IF EXISTS vendor_order_pickup_otp_attempts_bounded,
  DROP CONSTRAINT IF EXISTS vendor_order_pickup_otp_hash_shape,
  DROP CONSTRAINT IF EXISTS vendor_order_package_note_shape,
  DROP CONSTRAINT IF EXISTS vendor_order_package_count_positive,
  DROP CONSTRAINT IF EXISTS vendor_order_decline_note_shape,
  DROP CONSTRAINT IF EXISTS vendor_order_decline_reason_shape,
  DROP CONSTRAINT IF EXISTS vendor_order_prep_estimate_positive,
  DROP COLUMN IF EXISTS picked_up_at,
  DROP COLUMN IF EXISTS pickup_otp_attempts,
  DROP COLUMN IF EXISTS pickup_otp_expires_at,
  DROP COLUMN IF EXISTS pickup_otp_hash,
  DROP COLUMN IF EXISTS pickup_promise_at,
  DROP COLUMN IF EXISTS package_condition_note,
  DROP COLUMN IF EXISTS package_count,
  DROP COLUMN IF EXISTS ready_at,
  DROP COLUMN IF EXISTS picking_started_at,
  DROP COLUMN IF EXISTS decline_note,
  DROP COLUMN IF EXISTS decline_reason_code,
  DROP COLUMN IF EXISTS preparation_estimate_seconds,
  DROP COLUMN IF EXISTS accepted_at,
  DROP COLUMN IF EXISTS accept_by;

ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_orders_lifecycle_state_check;
ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_orders_lifecycle_state_check
    CHECK (lifecycle_state IN ('PLACED','ACCEPTED','CANCELLED','EXPIRED'));
