-- Rows carrying the new reason would violate the narrower constraint; they are
-- quote evidence for quotes that have long since expired, so the safe reversal
-- removes them rather than leaving a constraint the table cannot satisfy.
DELETE FROM marketplace.checkout_quote_blocked_groups
 WHERE reason_code = 'FULFILMENT_METHOD_UNAVAILABLE';
ALTER TABLE marketplace.checkout_quote_blocked_groups
  DROP CONSTRAINT checkout_quote_blocked_groups_reason_code_check,
  ADD CONSTRAINT checkout_quote_blocked_groups_reason_code_check CHECK
    (reason_code IN ('MINIMUM_NOT_MET', 'INVENTORY_UNAVAILABLE', 'STORE_UNAVAILABLE'));

DELETE FROM marketplace.locale_translations
 WHERE locale_key = 'cart.fulfilment_method_unavailable';
DELETE FROM marketplace.locale_keys
 WHERE locale_key = 'cart.fulfilment_method_unavailable';
