DELETE FROM marketplace.locale_translations
 WHERE locale_key IN ('checkout.payment_declined', 'checkout.quote_expired', 'checkout.quote_changed')
    OR locale_key LIKE 'customer.checkout.declined.%'
    OR locale_key LIKE 'customer.checkout.changed.%'
    OR locale_key LIKE 'customer.checkout.interrupted.%'
    OR locale_key = 'customer.checkout.processing'
    OR locale_key IN ('customer.quote.method', 'customer.quote.decision', 'customer.quote.no_buffer')
    OR locale_key LIKE 'customer.quote.decision.%';
DELETE FROM marketplace.locale_keys
 WHERE locale_key IN ('checkout.payment_declined', 'checkout.quote_expired', 'checkout.quote_changed')
    OR locale_key LIKE 'customer.checkout.declined.%'
    OR locale_key LIKE 'customer.checkout.changed.%'
    OR locale_key LIKE 'customer.checkout.interrupted.%'
    OR locale_key = 'customer.checkout.processing'
    OR locale_key IN ('customer.quote.method', 'customer.quote.decision', 'customer.quote.no_buffer')
    OR locale_key LIKE 'customer.quote.decision.%';
ALTER TABLE marketplace.vendor_order_lines DROP COLUMN substitution_preference;
ALTER TABLE marketplace.checkout_quote_lines DROP COLUMN substitution_preference;
