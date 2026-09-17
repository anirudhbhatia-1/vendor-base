ALTER TABLE marketplace.vendor_order_events
  DROP CONSTRAINT vendor_order_event_type_allowed;
ALTER TABLE marketplace.vendor_order_events
  ADD CONSTRAINT vendor_order_event_type_allowed
    CHECK (event_type IN
      ('PLACED','ACCEPTED','DECLINED','TIMED_OUT','PICKING_STARTED','LINE_PICKED','LINE_MISSING',
       'SUBSTITUTION_PROPOSED','WEIGHT_PROPOSED','SUBSTITUTION_APPROVED','SUBSTITUTION_REJECTED',
       'WEIGHT_APPROVED','WEIGHT_REJECTED','READY','PICKUP_OTP_ISSUED','PICKUP_OTP_ATTEMPTED',
       'PICKED_UP','DELIVERED','RETURNED','RATING_SUBMITTED','SUPPORT_CASE_OPENED'));

DELETE FROM marketplace.payment_authorization_adjustments
  WHERE adjustment_kind = 'VENDOR_ORDER_ENDED';

DROP INDEX marketplace.payment_authorization_adjustment_ended_order_unique;
DROP INDEX marketplace.payment_authorization_adjustment_decision_unique;

ALTER TABLE marketplace.payment_authorization_adjustments
  DROP CONSTRAINT payment_authorization_adjustment_kind_shape,
  DROP CONSTRAINT payment_authorization_adjustment_kind_allowed;

ALTER TABLE marketplace.payment_authorization_adjustments
  ADD CONSTRAINT payment_authorization_adjustments_decision_id_key UNIQUE (decision_id);

ALTER TABLE marketplace.payment_authorization_adjustments
  ALTER COLUMN decision_id SET NOT NULL;

ALTER TABLE marketplace.payment_authorization_adjustments
  DROP COLUMN adjustment_kind;
