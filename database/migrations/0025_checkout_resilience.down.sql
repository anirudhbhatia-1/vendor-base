ALTER TABLE marketplace.checkout_groups
  DROP CONSTRAINT IF EXISTS checkout_customer_idempotency_unique,
  DROP CONSTRAINT IF EXISTS checkout_idempotency_key_shape,
  DROP COLUMN IF EXISTS idempotency_key;

DROP TABLE IF EXISTS marketplace.checkout_quote_blocked_groups;
