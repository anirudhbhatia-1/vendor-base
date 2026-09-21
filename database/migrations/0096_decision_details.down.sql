DELETE FROM marketplace.locale_translations WHERE locale_key IN (
  'customer.decisions.ordered', 'customer.decisions.offered', 'customer.decisions.more',
  'customer.decisions.less', 'customer.decisions.same_price',
  'customer.notification.substitution_applied', 'customer.notification.weight_applied');
DELETE FROM marketplace.locale_keys WHERE locale_key IN (
  'customer.decisions.ordered', 'customer.decisions.offered', 'customer.decisions.more',
  'customer.decisions.less', 'customer.decisions.same_price',
  'customer.notification.substitution_applied', 'customer.notification.weight_applied');
DROP INDEX marketplace.payment_authorization_adjustment_lines_unique;
-- A database that has recorded a LINES_NOT_SUPPLIED adjustment fails on the
-- narrower constraint, which is the honest outcome.
ALTER TABLE marketplace.payment_authorization_adjustments
  DROP CONSTRAINT payment_authorization_adjustment_kind_allowed,
  ADD CONSTRAINT payment_authorization_adjustment_kind_allowed
    CHECK (adjustment_kind IN ('CUSTOMER_DECISION', 'VENDOR_ORDER_ENDED'));
ALTER TABLE marketplace.vendor_order_events DROP COLUMN decision_id;
