-- Vendor self-delivery (VEN-37, workflow 6.7): the store's own staff carry the
-- order to the customer.
--
-- A customer could choose VENDOR_DELIVERY at checkout and the order could reach
-- READY, and then nothing: the console said the step was "not available yet",
-- the customer's delivery code was minted only on a delivery assignment (which
-- a self-delivery never has), and the domain still accepted a vendor fallback
-- collection code on such an order -- which would have recorded the handover as
-- a customer collection and left the order at PICKED_UP with no way to reach
-- DELIVERED. Settlement runs on DELIVERED, so the shop would never have been paid.
--
-- The self-delivery leg reuses the order's own states -- READY -> PICKED_UP
-- (the goods left the shop with a named member of staff) -> DELIVERED (the
-- customer's delivery code was validated at the door) -- and keeps the
-- customer's delivery code on the order, where a self-delivery has something to
-- hang it on, with the same lifetime and attempt ceiling as every other code.
ALTER TABLE marketplace.vendor_orders
  ADD COLUMN vendor_delivery_by_user_id uuid,
  ADD COLUMN out_for_delivery_at timestamptz,
  ADD COLUMN delivery_otp_hash text,
  ADD COLUMN delivery_otp_expires_at timestamptz,
  ADD COLUMN delivery_otp_attempts integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT vendor_delivery_by_fk FOREIGN KEY (vendor_delivery_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  ADD CONSTRAINT vendor_order_delivery_otp_shape CHECK
    ((delivery_otp_hash IS NULL) = (delivery_otp_expires_at IS NULL)),
  ADD CONSTRAINT vendor_order_delivery_otp_attempts_bounded CHECK
    (delivery_otp_attempts >= 0);

-- The order's history gains the two events the door produces, mirroring the
-- counter's PICKUP_OTP_ISSUED / PICKUP_OTP_ATTEMPTED.
ALTER TABLE marketplace.vendor_order_events
  DROP CONSTRAINT vendor_order_event_type_allowed;
ALTER TABLE marketplace.vendor_order_events
  ADD CONSTRAINT vendor_order_event_type_allowed
    CHECK (event_type IN
      ('PLACED','ACCEPTED','DECLINED','TIMED_OUT','CANCELLED','PICKING_STARTED','LINE_PICKED',
       'LINE_MISSING','SUBSTITUTION_PROPOSED','WEIGHT_PROPOSED','SUBSTITUTION_APPROVED',
       'SUBSTITUTION_REJECTED','WEIGHT_APPROVED','WEIGHT_REJECTED','READY','PICKUP_OTP_ISSUED',
       'PICKUP_OTP_ATTEMPTED','PICKED_UP','DELIVERY_OTP_ISSUED','DELIVERY_OTP_ATTEMPTED',
       'DELIVERED','RETURNED','RATING_SUBMITTED','SUPPORT_CASE_OPENED'));
