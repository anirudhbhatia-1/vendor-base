-- 10.5: a provider statement is matched against the books, what the books
-- hold and the statement does not is missing, a definitive answer settles
-- what was waiting for one, and every exception belongs to someone.
--
-- Until audit run 70 a statement had no period, so nothing it left out could
-- be named; MISSING_EXPECTED was a class no code wrote. A statement row that
-- answered an operation we were still waiting on was filed as a status
-- mismatch for a person rather than applied. A refund the provider refused
-- stayed FAILED_RETRYABLE and was never tried again. Most finance exceptions
-- were written with no owner.

-- The window a statement covers: operations the books settled inside it are
-- expected on it. A statement imported without one is matched row by row
-- and names nothing missing.
ALTER TABLE marketplace.provider_statement_imports
  ADD COLUMN period_start timestamptz,
  ADD COLUMN period_end timestamptz,
  ADD CONSTRAINT provider_statement_import_period_shape CHECK (
    (period_start IS NULL) = (period_end IS NULL)
    AND (period_start IS NULL OR period_start < period_end));

-- A missing operation is a row of the statement it is missing from: the
-- amount and state the books expected, and no provider state, because the
-- provider said nothing.
ALTER TABLE marketplace.provider_statement_rows ALTER COLUMN provider_state DROP NOT NULL;
ALTER TABLE marketplace.provider_statement_rows
  ADD CONSTRAINT statement_missing_shape CHECK (
    (provider_state IS NULL) = (reconciliation_class IS NOT DISTINCT FROM 'MISSING_EXPECTED'));

-- A refund the provider refused is proposed again as a new refund under a
-- new provider operation, for a person to approve; the new one names the one
-- it retries, and a refusal is retried once at a time.
ALTER TABLE marketplace.refunds
  ADD COLUMN retry_of_refund_id uuid UNIQUE
    REFERENCES marketplace.refunds (refund_id) ON DELETE RESTRICT,
  ADD CONSTRAINT refund_retry_not_self CHECK (retry_of_refund_id IS DISTINCT FROM refund_id);

-- Every exception has an owner: a queue that works it.
UPDATE marketplace.finance_exceptions SET owner_reference = 'FINANCE_OPERATIONS'
 WHERE owner_reference IS NULL;
ALTER TABLE marketplace.finance_exceptions
  ALTER COLUMN owner_reference SET DEFAULT 'FINANCE_OPERATIONS',
  ALTER COLUMN owner_reference SET NOT NULL,
  ADD CONSTRAINT finance_exception_owner_allowed CHECK (owner_reference IN
    ('FINANCE_OPERATIONS', 'FINANCE_RECONCILIATION'));
