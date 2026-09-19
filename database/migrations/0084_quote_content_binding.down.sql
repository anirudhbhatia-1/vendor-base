DELETE FROM marketplace.locale_translations WHERE locale_key LIKE 'customer.quote.blocked.%';
DELETE FROM marketplace.locale_keys WHERE locale_key LIKE 'customer.quote.blocked.%';
DELETE FROM marketplace.checkout_quote_blocked_groups WHERE reason_code = 'LINE_UNAVAILABLE';
ALTER TABLE marketplace.checkout_quote_blocked_groups
  DROP CONSTRAINT checkout_quote_blocked_groups_reason_code_check,
  ADD CONSTRAINT checkout_quote_blocked_groups_reason_code_check CHECK
    (reason_code IN ('FULFILMENT_METHOD_UNAVAILABLE', 'MINIMUM_NOT_MET',
                     'INVENTORY_UNAVAILABLE', 'STORE_UNAVAILABLE'));
DROP INDEX marketplace.one_live_quote_per_content;
-- Lapsed quotes that share a content digest cannot all satisfy a global
-- uniqueness again. The reversal keeps every row (groups and lines refer to
-- them) and gives each older duplicate a digest derived from its own id, so
-- the constraint holds and the evidence stays.
UPDATE marketplace.checkout_quotes older
   SET quote_digest = encode(sha256((older.quote_digest || older.checkout_quote_id::text)::bytea), 'hex')
 WHERE EXISTS (
   SELECT 1 FROM marketplace.checkout_quotes newer
    WHERE newer.quote_digest = older.quote_digest
      AND newer.created_at > older.created_at
 );
ALTER TABLE marketplace.checkout_quotes
  ADD CONSTRAINT checkout_quotes_quote_digest_key UNIQUE (quote_digest);
