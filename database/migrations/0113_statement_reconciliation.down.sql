ALTER TABLE marketplace.finance_exceptions
  DROP CONSTRAINT finance_exception_owner_allowed,
  ALTER COLUMN owner_reference DROP NOT NULL,
  ALTER COLUMN owner_reference DROP DEFAULT;

ALTER TABLE marketplace.refunds
  DROP CONSTRAINT refund_retry_not_self,
  DROP COLUMN retry_of_refund_id;

-- A missing row has no provider state and cannot be represented before this
-- migration; rolling back past one is refused rather than guessed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.provider_statement_rows WHERE provider_state IS NULL) THEN
    RAISE EXCEPTION 'missing statement rows exist; 0113 cannot be rolled back'
      USING ERRCODE = '55000';
  END IF;
END;
$$;
ALTER TABLE marketplace.provider_statement_rows DROP CONSTRAINT statement_missing_shape;
ALTER TABLE marketplace.provider_statement_rows ALTER COLUMN provider_state SET NOT NULL;

ALTER TABLE marketplace.provider_statement_imports
  DROP CONSTRAINT provider_statement_import_period_shape,
  DROP COLUMN period_end,
  DROP COLUMN period_start;
