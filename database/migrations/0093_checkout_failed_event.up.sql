-- Phase 7.8: a placement the provider authorised that could not be fulfilled.
--
-- When the orders could not be made -- a hold no longer there by the time
-- the provider's answer arrived -- the settlement threw the whole answer
-- away: the group stayed PROCESSING with the customer's money authorised and
-- every sweep ran into the same missing hold. The placement is ended instead,
-- the money released through the provider, and this is its record.
ALTER TABLE marketplace.checkout_events
  DROP CONSTRAINT checkout_events_event_type_check,
  ADD CONSTRAINT checkout_events_event_type_check CHECK
    (event_type IN ('QUOTE_CREATED', 'CHECKOUT_SUBMITTED', 'PAYMENT_AUTHORIZED', 'PAYMENT_DECLINED',
                    'PAYMENT_UNKNOWN', 'PAYMENT_ABANDONED', 'CHECKOUT_PLACED', 'CHECKOUT_FAILED',
                    'WEBHOOK_ACCEPTED'));
