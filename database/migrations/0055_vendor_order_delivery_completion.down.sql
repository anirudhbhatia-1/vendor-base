ALTER TABLE marketplace.vendor_order_events
  DROP CONSTRAINT vendor_order_events_actor_kind_check;
ALTER TABLE marketplace.vendor_order_events
  ADD CONSTRAINT vendor_order_events_actor_kind_check
    CHECK (actor_kind IN ('customer','vendor_staff','system'));

ALTER TABLE marketplace.vendor_order_events
  DROP CONSTRAINT vendor_order_event_type_allowed;
ALTER TABLE marketplace.vendor_order_events
  ADD CONSTRAINT vendor_order_event_type_allowed
    CHECK (event_type IN
      ('PLACED','ACCEPTED','DECLINED','TIMED_OUT','PICKING_STARTED','LINE_PICKED','LINE_MISSING',
       'SUBSTITUTION_PROPOSED','WEIGHT_PROPOSED','SUBSTITUTION_APPROVED','SUBSTITUTION_REJECTED',
       'WEIGHT_APPROVED','WEIGHT_REJECTED','READY','PICKUP_OTP_ISSUED','PICKUP_OTP_ATTEMPTED',
       'PICKED_UP','RATING_SUBMITTED','SUPPORT_CASE_OPENED'));

ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_delivery_completes_once,
  DROP CONSTRAINT vendor_order_return_completes_once;

ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_pickup_completes_once;
ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_order_pickup_completes_once
    CHECK ((lifecycle_state = 'PICKED_UP') = (picked_up_at IS NOT NULL));

ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_ready_snapshot_shape;
ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_order_ready_snapshot_shape
    CHECK ((lifecycle_state IN ('READY','PICKED_UP'))
             = (ready_at IS NOT NULL AND package_count IS NOT NULL));

ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_orders_lifecycle_state_check;
ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_orders_lifecycle_state_check
    CHECK (lifecycle_state IN ('PLACED','ACCEPTED','PICKING','READY','PICKED_UP','CANCELLED','EXPIRED'));

ALTER TABLE marketplace.vendor_orders
  DROP COLUMN delivered_at,
  DROP COLUMN returned_at;
