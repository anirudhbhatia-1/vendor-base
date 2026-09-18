-- The order history is append-only, so events of the two new types cannot be
-- deleted; a reversal on a database that has recorded any would fail on the
-- narrower constraint, which is the honest outcome -- history that happened is
-- not un-happened by rolling a schema back.
ALTER TABLE marketplace.vendor_order_events
  DROP CONSTRAINT vendor_order_event_type_allowed;
ALTER TABLE marketplace.vendor_order_events
  ADD CONSTRAINT vendor_order_event_type_allowed
    CHECK (event_type IN
      ('PLACED','ACCEPTED','DECLINED','TIMED_OUT','CANCELLED','PICKING_STARTED','LINE_PICKED',
       'LINE_MISSING','SUBSTITUTION_PROPOSED','WEIGHT_PROPOSED','SUBSTITUTION_APPROVED',
       'SUBSTITUTION_REJECTED','WEIGHT_APPROVED','WEIGHT_REJECTED','READY','PICKUP_OTP_ISSUED',
       'PICKUP_OTP_ATTEMPTED','PICKED_UP','DELIVERED','RETURNED','RATING_SUBMITTED',
       'SUPPORT_CASE_OPENED'));

ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_delivery_otp_attempts_bounded,
  DROP CONSTRAINT vendor_order_delivery_otp_shape,
  DROP CONSTRAINT vendor_delivery_by_fk,
  DROP COLUMN delivery_otp_attempts,
  DROP COLUMN delivery_otp_expires_at,
  DROP COLUMN delivery_otp_hash,
  DROP COLUMN out_for_delivery_at,
  DROP COLUMN vendor_delivery_by_user_id;
