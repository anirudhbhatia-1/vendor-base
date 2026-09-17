-- An order that ends before it is supplied must stop being charged for.
--
-- 0038 built exactly the right mechanism — shrink the authorization before
-- capture, append-only, with the before and after amounts recorded — but tied
-- it to a `decision_id`, so it could only express a substitution or a weight
-- change. A declined, timed-out or cancelled order had no way to reduce what
-- the customer would be charged.
--
-- That matters because one authorization funds an entire checkout group. With a
-- basket from two shops, one accepting and one declining, capture takes the
-- whole amount: the customer pays for goods nobody is going to supply, and the
-- money comes back only if a human remembers to refund it. Reducing the
-- authorization instead is the per-shop form of "decline releases the money",
-- and it leaves nothing owed.
--
-- `decision_id` becomes optional and `adjustment_kind` says which kind of event
-- caused the adjustment. Uniqueness follows the kind: one adjustment per
-- customer decision as before, and one per vendor order for an ending, which is
-- what makes a replayed decline harmless.

ALTER TABLE marketplace.payment_authorization_adjustments
  ADD COLUMN adjustment_kind text NOT NULL DEFAULT 'CUSTOMER_DECISION';

ALTER TABLE marketplace.payment_authorization_adjustments
  ALTER COLUMN decision_id DROP NOT NULL;

ALTER TABLE marketplace.payment_authorization_adjustments
  DROP CONSTRAINT payment_authorization_adjustments_decision_id_key;

ALTER TABLE marketplace.payment_authorization_adjustments
  ADD CONSTRAINT payment_authorization_adjustment_kind_allowed
    CHECK (adjustment_kind IN ('CUSTOMER_DECISION', 'VENDOR_ORDER_ENDED')),
  -- A customer-decision adjustment names its decision; an ending never has one.
  ADD CONSTRAINT payment_authorization_adjustment_kind_shape
    CHECK ((adjustment_kind = 'CUSTOMER_DECISION') = (decision_id IS NOT NULL));

CREATE UNIQUE INDEX payment_authorization_adjustment_decision_unique
  ON marketplace.payment_authorization_adjustments (decision_id)
  WHERE decision_id IS NOT NULL;

-- One ending adjustment per order, so a replayed decline cannot reduce the
-- authorization twice.
CREATE UNIQUE INDEX payment_authorization_adjustment_ended_order_unique
  ON marketplace.payment_authorization_adjustments (vendor_order_id)
  WHERE adjustment_kind = 'VENDOR_ORDER_ENDED';

-- `cancelByCustomer` has always written a CANCELLED row into the order history,
-- and CANCELLED has never been in that table's permitted vocabulary — it is a
-- lifecycle state, not an event type, and the two lists were never reconciled.
-- Every customer cancellation therefore failed on this check. It belongs here
-- because it is the third way an order ends, alongside declining and timing out.
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
