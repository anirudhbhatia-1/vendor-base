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

ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_delay_shape,
  DROP CONSTRAINT vendor_order_delay_reason_shape,
  DROP COLUMN delay_reported_at,
  DROP COLUMN delay_reason_code;

ALTER TABLE marketplace.assignment_events
  DROP CONSTRAINT assignment_event_type_allowed,
  ADD CONSTRAINT assignment_event_type_allowed CHECK (event_type IN
    ('ASSIGNMENT_CREATED', 'OFFERED', 'ACCEPTED', 'ARRIVAL_CLAIMED', 'AT_VENDOR',
     'PICKUP_CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'DECLINED', 'OFFER_EXPIRED',
     'FAILED_PICKUP', 'REASSIGNED', 'CANCELLED', 'DELIVERY_FAILED',
     'RETURN_REQUIRED', 'RETURN_AUTHORIZED', 'RETURNING', 'RETURNED'));

ALTER TABLE marketplace.partner_wait_timer_events
  DROP CONSTRAINT partner_wait_timer_events_actor_kind_check,
  ADD CONSTRAINT partner_wait_timer_events_actor_kind_check
    CHECK (actor_kind IN ('delivery_partner','system','admin'));

ALTER TABLE marketplace.partner_wait_earning_adjustments
  DROP CONSTRAINT partner_wait_earning_adjustments_attempt_partner_unique,
  ADD CONSTRAINT partner_wait_earning_adjustments_delivery_assignment_id_key
    UNIQUE (delivery_assignment_id);
ALTER TABLE marketplace.partner_wait_timers
  DROP CONSTRAINT partner_wait_timers_attempt_partner_unique,
  ADD CONSTRAINT partner_wait_timers_delivery_assignment_id_key UNIQUE (delivery_assignment_id);
