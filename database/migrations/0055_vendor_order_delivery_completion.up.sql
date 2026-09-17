-- The vendor order can finally finish.
--
-- Until now `vendor_orders.lifecycle_state` topped out at PICKED_UP (0026).
-- A platform delivery was recorded only on `delivery_assignments`, so the
-- order the customer placed had no terminal state, no completion timestamp,
-- and emitted no event. Everything that should follow a delivery — payment
-- capture, the vendor payable, the partner earning, the review window — was
-- therefore reachable only by calling a finance endpoint by hand.
--
-- DELIVERED and RETURNED are mutually exclusive terminal states, and both are
-- only reachable from PICKED_UP: `assignment_custody.confirmPickup` already
-- refuses custody unless the vendor order has completed handover, so neither
-- state can be reached without a pickup having happened. That is what lets the
-- pickup-shaped constraints below simply widen rather than be rewritten.

ALTER TABLE marketplace.vendor_orders
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN returned_at timestamptz;

ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_orders_lifecycle_state_check;
ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_orders_lifecycle_state_check
    CHECK (lifecycle_state IN
      ('PLACED','ACCEPTED','PICKING','READY','PICKED_UP','DELIVERED','RETURNED','CANCELLED','EXPIRED'));

-- The ready snapshot and the pickup timestamp survive into both terminal
-- states. Left unwidened, the first DELIVERED write would violate both of
-- these: the order still carries ready_at and picked_up_at, but its state
-- would no longer be in the list that requires them.
ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_ready_snapshot_shape;
ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_order_ready_snapshot_shape
    CHECK ((lifecycle_state IN ('READY','PICKED_UP','DELIVERED','RETURNED'))
             = (ready_at IS NOT NULL AND package_count IS NOT NULL));

ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_pickup_completes_once;
ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_order_pickup_completes_once
    CHECK ((lifecycle_state IN ('PICKED_UP','DELIVERED','RETURNED'))
             = (picked_up_at IS NOT NULL));

-- Each terminal state carries its own timestamp, the way accepted_at, ready_at
-- and picked_up_at already do, so completion time is a domain fact rather than
-- an inference from updated_at.
ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_order_delivery_completes_once
    CHECK ((lifecycle_state = 'DELIVERED') = (delivered_at IS NOT NULL)),
  ADD CONSTRAINT vendor_order_return_completes_once
    CHECK ((lifecycle_state = 'RETURNED') = (returned_at IS NOT NULL));

-- The history vocabulary gains the two transitions, and the actor vocabulary
-- gains the partner. `aggregate_transitions` (0002) has always permitted
-- 'delivery_partner'; this aligns the order's own history with it rather than
-- introducing a new actor kind. Attributing the delivery to 'system' would
-- have been a lie about who completed it.
ALTER TABLE marketplace.vendor_order_events
  DROP CONSTRAINT vendor_order_event_type_allowed;
ALTER TABLE marketplace.vendor_order_events
  ADD CONSTRAINT vendor_order_event_type_allowed
    CHECK (event_type IN
      ('PLACED','ACCEPTED','DECLINED','TIMED_OUT','PICKING_STARTED','LINE_PICKED','LINE_MISSING',
       'SUBSTITUTION_PROPOSED','WEIGHT_PROPOSED','SUBSTITUTION_APPROVED','SUBSTITUTION_REJECTED',
       'WEIGHT_APPROVED','WEIGHT_REJECTED','READY','PICKUP_OTP_ISSUED','PICKUP_OTP_ATTEMPTED',
       'PICKED_UP','DELIVERED','RETURNED','RATING_SUBMITTED','SUPPORT_CASE_OPENED'));

ALTER TABLE marketplace.vendor_order_events
  DROP CONSTRAINT vendor_order_events_actor_kind_check;
ALTER TABLE marketplace.vendor_order_events
  ADD CONSTRAINT vendor_order_events_actor_kind_check
    CHECK (actor_kind IN ('customer','delivery_partner','system','vendor_staff'));
