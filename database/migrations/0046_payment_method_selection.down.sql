ALTER TABLE marketplace.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_method_allowed;

ALTER TABLE marketplace.payment_transactions
  DROP COLUMN IF EXISTS payment_method;
