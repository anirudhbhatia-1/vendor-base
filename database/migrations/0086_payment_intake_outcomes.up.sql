-- Phase 7.4: what happens to a payment the provider did not answer.
--
-- A placement whose provider gave no usable answer was held as
-- PAYMENT_UNKNOWN, and then nothing else ever touched it. The quote behind it
-- lapsed five minutes later and the expiry sweep gave its stock back, so a
-- late "succeeded" from the provider met a hold that was no longer there and
-- was refused on every redelivery; nobody was told the customer's money was
-- still authorised. The group now keeps its holds while the answer is
-- awaited, is abandoned after a deadline (holds released, the group
-- cancelled, the money left to reconciliation), and a webhook that arrives
-- after that voids the authorisation it reports instead of being refused.
ALTER TABLE marketplace.checkout_events
  DROP CONSTRAINT checkout_events_event_type_check,
  ADD CONSTRAINT checkout_events_event_type_check CHECK
    (event_type IN ('QUOTE_CREATED', 'PAYMENT_AUTHORIZED', 'PAYMENT_DECLINED', 'PAYMENT_UNKNOWN',
                    'PAYMENT_ABANDONED', 'CHECKOUT_PLACED', 'WEBHOOK_ACCEPTED'));

-- The webhook receipt already keeps the digest of what was delivered; the
-- operation it was for is what a second delivery of the same event is
-- compared against, so a reused event id carrying a different payload can
-- be refused rather than waved through as a replay.
CREATE INDEX provider_webhook_receipts_operation
  ON marketplace.provider_webhook_receipts (provider_operation_reference, received_at);

-- Unknown payments waiting on the provider, oldest first, for the
-- abandonment sweep.
CREATE INDEX checkout_groups_payment_unknown_age
  ON marketplace.checkout_groups (created_at)
  WHERE lifecycle_state = 'PAYMENT_UNKNOWN';
