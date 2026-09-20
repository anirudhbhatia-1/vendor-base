DROP INDEX marketplace.checkout_groups_payment_unknown_age;
DROP INDEX marketplace.provider_webhook_receipts_operation;
-- The checkout history is append-only, so abandonment events cannot be
-- deleted; a reversal on a database that has recorded one fails on the
-- narrower constraint, which is the honest outcome.
ALTER TABLE marketplace.checkout_events
  DROP CONSTRAINT checkout_events_event_type_check,
  ADD CONSTRAINT checkout_events_event_type_check CHECK
    (event_type IN ('QUOTE_CREATED', 'PAYMENT_AUTHORIZED', 'PAYMENT_DECLINED', 'PAYMENT_UNKNOWN',
                    'CHECKOUT_PLACED', 'WEBHOOK_ACCEPTED'));
