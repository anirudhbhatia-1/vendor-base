-- 9.5: the vendor wait is the server's, from arrival to handover, and it is
-- paid; the store can say it is running late; a partner may leave under the
-- policy and the attempt goes back to the pool.
--
-- Until audit run 60 the wait timer was the partner's to remember to start,
-- nothing ever ended it, "leave" at the store was refused, and the waiting pay
-- the screen counted up was never carried into any earning or settlement.

-- One wait per partner per attempt. The attempt row is reused when a partner
-- leaves and the order is re-offered, so the next partner's wait must have
-- its own row; the old key made that impossible.
ALTER TABLE marketplace.partner_wait_timers
  DROP CONSTRAINT partner_wait_timers_delivery_assignment_id_key,
  ADD CONSTRAINT partner_wait_timers_attempt_partner_unique
    UNIQUE (delivery_assignment_id, partner_user_id);
ALTER TABLE marketplace.partner_wait_earning_adjustments
  DROP CONSTRAINT partner_wait_earning_adjustments_delivery_assignment_id_key,
  ADD CONSTRAINT partner_wait_earning_adjustments_attempt_partner_unique
    UNIQUE (delivery_assignment_id, partner_user_id);

-- The counter's confirmation of an arrival opens the wait, so the store's
-- own staff can be the actor on a wait event.
ALTER TABLE marketplace.partner_wait_timer_events
  DROP CONSTRAINT partner_wait_timer_events_actor_kind_check,
  ADD CONSTRAINT partner_wait_timer_events_actor_kind_check
    CHECK (actor_kind IN ('delivery_partner','system','admin','vendor_staff'));

-- Leaving the store under the policy is its own event in the attempt's history.
ALTER TABLE marketplace.assignment_events
  DROP CONSTRAINT assignment_event_type_allowed,
  ADD CONSTRAINT assignment_event_type_allowed CHECK (event_type IN
    ('ASSIGNMENT_CREATED', 'OFFERED', 'ACCEPTED', 'ARRIVAL_CLAIMED', 'AT_VENDOR',
     'LEFT_AFTER_WAIT', 'PICKUP_CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'DECLINED',
     'OFFER_EXPIRED', 'FAILED_PICKUP', 'REASSIGNED', 'CANCELLED', 'DELIVERY_FAILED',
     'RETURN_REQUIRED', 'RETURN_AUTHORIZED', 'RETURNING', 'RETURNED'));

-- The store's delay: why, when, and the revised estimate lands on
-- preparation_estimate_seconds so every reading of "ready by" moves with it.
ALTER TABLE marketplace.vendor_orders
  ADD COLUMN delay_reason_code text,
  ADD COLUMN delay_reported_at timestamptz,
  ADD CONSTRAINT vendor_order_delay_reason_shape CHECK
    (delay_reason_code IS NULL OR delay_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  ADD CONSTRAINT vendor_order_delay_shape CHECK
    ((delay_reason_code IS NULL) = (delay_reported_at IS NULL));

ALTER TABLE marketplace.vendor_order_events
  DROP CONSTRAINT vendor_order_event_type_allowed;
ALTER TABLE marketplace.vendor_order_events
  ADD CONSTRAINT vendor_order_event_type_allowed
    CHECK (event_type IN
      ('PLACED','ACCEPTED','DECLINED','TIMED_OUT','CANCELLED','PICKING_STARTED','LINE_PICKED',
       'LINE_MISSING','SUBSTITUTION_PROPOSED','WEIGHT_PROPOSED','SUBSTITUTION_APPROVED',
       'SUBSTITUTION_REJECTED','WEIGHT_APPROVED','WEIGHT_REJECTED','DELAY_REPORTED','READY',
       'PICKUP_OTP_ISSUED','PICKUP_OTP_ATTEMPTED','PICKED_UP','DELIVERY_OTP_ISSUED',
       'DELIVERY_OTP_ATTEMPTED','DELIVERED','RETURNED','RATING_SUBMITTED','SUPPORT_CASE_OPENED'));
