-- The new kinds and the history cannot be represented before this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.finance_exceptions WHERE exception_kind IN
               ('CAPTURE_ALLOCATION_MISMATCH', 'WEBHOOK_CONFLICT', 'REFUND_FAILED',
                'PARTNER_EARNING_MISMATCH', 'LEDGER_UNBALANCED')
               OR exception_state = 'ASSIGNED' OR financial_correction_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM marketplace.finance_exception_events
                 WHERE event_type NOT IN ('OPENED', 'RESOLVED')) THEN
    RAISE EXCEPTION 'finance queue history exists; 0119 cannot be rolled back' USING ERRCODE = '55000';
  END IF;
END;
$$;

DROP TRIGGER finance_exception_history ON marketplace.finance_exceptions;
DROP TRIGGER finance_exception_record ON marketplace.finance_exceptions;
DROP FUNCTION marketplace.finance_exception_history();
DROP FUNCTION marketplace.finance_exception_record();
DROP TABLE marketplace.finance_exception_events;
DROP INDEX marketplace.finance_exceptions_by_queue;
ALTER TABLE marketplace.finance_exceptions
  DROP CONSTRAINT finance_exception_resolution_shape,
  DROP CONSTRAINT finance_exception_resolution_code,
  DROP CONSTRAINT finance_exception_assignment_shape,
  DROP CONSTRAINT finance_exception_values,
  DROP CONSTRAINT finance_exception_version,
  DROP CONSTRAINT finance_exception_attempts,
  DROP COLUMN version,
  DROP COLUMN resolved_at,
  DROP COLUMN resolved_by_user_id,
  DROP COLUMN resolution_code,
  DROP COLUMN financial_correction_id,
  DROP COLUMN last_retry_at,
  DROP COLUMN attempts,
  DROP COLUMN assigned_to_user_id,
  DROP COLUMN business_reference,
  DROP COLUMN actual_minor,
  DROP COLUMN expected_minor,
  DROP COLUMN queue;
ALTER TABLE marketplace.finance_exceptions DROP CONSTRAINT finance_exception_kind_allowed;
ALTER TABLE marketplace.finance_exceptions ADD CONSTRAINT finance_exception_kind_allowed CHECK (exception_kind IN
  ('PAYMENT_UNKNOWN','REFUND_UNKNOWN','PAYOUT_UNKNOWN','STATEMENT_MISSING','STATEMENT_CONFLICT',
   'STATEMENT_UNMATCHED','STATEMENT_DUPLICATE','AMOUNT_MISMATCH','STATUS_MISMATCH',
   'LEDGER_UNBALANCED','PAYOUT_DUPLICATE_RISK','CORRECTION_REVIEW',
   'SETTLEMENT_MISMATCH','POSTING_FAILED','PAYOUT_FAILED'));
DROP FUNCTION marketplace.finance_queue(text, text);
