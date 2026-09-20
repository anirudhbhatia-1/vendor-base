-- Phase 7.5: the submission is recorded before the provider is asked.
--
-- A placement used to ask the provider for money inside the transaction
-- that would record the answer, with nothing written until it came back:
-- a process that died after the provider had authorised left the money
-- held and no record of it, and a row lock was held for as long as the
-- provider took to answer. The submission is now its own transaction --
-- payment attempt, group in PROCESSING, holds carried to the submission's
-- deadline, transition and outbox event -- then the provider is asked
-- outside any transaction, then the answer is recorded. CHECKOUT_SUBMITTED
-- is that first record in the checkout's history.
ALTER TABLE marketplace.checkout_events
  DROP CONSTRAINT checkout_events_event_type_check,
  ADD CONSTRAINT checkout_events_event_type_check CHECK
    (event_type IN ('QUOTE_CREATED', 'CHECKOUT_SUBMITTED', 'PAYMENT_AUTHORIZED', 'PAYMENT_DECLINED',
                    'PAYMENT_UNKNOWN', 'PAYMENT_ABANDONED', 'CHECKOUT_PLACED', 'WEBHOOK_ACCEPTED'));

-- Submissions whose answer was never recorded, oldest first, for the
-- reconciliation sweep.
CREATE INDEX checkout_groups_processing_age
  ON marketplace.checkout_groups (created_at)
  WHERE lifecycle_state = 'PROCESSING';
