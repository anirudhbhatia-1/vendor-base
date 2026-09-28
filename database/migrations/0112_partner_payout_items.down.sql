DELETE FROM marketplace.finance_exceptions WHERE exception_kind = 'PAYOUT_FAILED';
ALTER TABLE marketplace.finance_exceptions DROP CONSTRAINT finance_exception_kind_allowed;
ALTER TABLE marketplace.finance_exceptions ADD CONSTRAINT finance_exception_kind_allowed CHECK (exception_kind IN
  ('PAYMENT_UNKNOWN','REFUND_UNKNOWN','PAYOUT_UNKNOWN','STATEMENT_MISSING','STATEMENT_CONFLICT',
   'STATEMENT_UNMATCHED','STATEMENT_DUPLICATE','AMOUNT_MISMATCH','STATUS_MISMATCH',
   'LEDGER_UNBALANCED','PAYOUT_DUPLICATE_RISK','CORRECTION_REVIEW',
   'SETTLEMENT_MISMATCH','POSTING_FAILED'));

DROP TRIGGER partner_payout_items_sum ON marketplace.partner_payout_items;
DROP FUNCTION marketplace.ensure_partner_payout_matches_items();
DROP TRIGGER partner_payout_items_append_only ON marketplace.partner_payout_items;
DROP FUNCTION marketplace.protect_partner_payout_items();
DROP TABLE marketplace.partner_payout_items;

CREATE OR REPLACE FUNCTION marketplace.protect_partner_attempt_compensations()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'partner attempt compensations are append-only' USING ERRCODE='55000'; END;
$$;
DROP INDEX marketplace.partner_attempt_compensations_unposted;
ALTER TABLE marketplace.partner_attempt_compensations
  DROP CONSTRAINT partner_attempt_compensation_posting_shape,
  DROP COLUMN posted_at,
  DROP COLUMN ledger_transaction_id;

-- A partner payout that clears no settlement cannot be represented before
-- this migration; rolling back past one is refused rather than guessed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.payouts WHERE settlement_id IS NULL) THEN
    RAISE EXCEPTION 'partner payouts without a settlement exist; 0112 cannot be rolled back'
      USING ERRCODE = '55000';
  END IF;
END;
$$;
DROP INDEX marketplace.payouts_partner;
ALTER TABLE marketplace.payouts
  DROP CONSTRAINT payout_partner_identity,
  DROP CONSTRAINT payout_beneficiary_owner,
  DROP COLUMN partner_user_id,
  ALTER COLUMN settlement_id SET NOT NULL;
