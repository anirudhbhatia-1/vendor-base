CREATE OR REPLACE FUNCTION marketplace.protect_vendor_settlement_adjustments()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vendor settlement adjustments are append-only' USING ERRCODE = '55000';
  END IF;
  IF OLD.ledger_transaction_id IS NOT NULL
     OR NEW.vendor_settlement_adjustment_id <> OLD.vendor_settlement_adjustment_id
     OR NEW.settlement_id <> OLD.settlement_id
     OR NEW.vendor_settlement_dispute_id <> OLD.vendor_settlement_dispute_id
     OR NEW.delta_minor <> OLD.delta_minor
     OR NEW.reason_code <> OLD.reason_code
     OR NEW.decided_by_user_id <> OLD.decided_by_user_id THEN
    RAISE EXCEPTION 'vendor settlement adjustments are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
ALTER TABLE marketplace.vendor_settlement_adjustments DROP COLUMN applied_to_settlement;
DROP INDEX IF EXISTS marketplace.finance_exceptions_open_operation;
DELETE FROM marketplace.finance_exceptions
 WHERE exception_kind IN ('SETTLEMENT_MISMATCH', 'POSTING_FAILED');
ALTER TABLE marketplace.finance_exceptions DROP CONSTRAINT finance_exception_kind_allowed;
ALTER TABLE marketplace.finance_exceptions ADD CONSTRAINT finance_exception_kind_allowed CHECK (exception_kind IN
  ('PAYMENT_UNKNOWN','REFUND_UNKNOWN','PAYOUT_UNKNOWN','STATEMENT_MISSING','STATEMENT_CONFLICT',
   'STATEMENT_UNMATCHED','STATEMENT_DUPLICATE','AMOUNT_MISMATCH','STATUS_MISMATCH',
   'LEDGER_UNBALANCED','PAYOUT_DUPLICATE_RISK','CORRECTION_REVIEW'));
DROP INDEX IF EXISTS marketplace.refunds_order_state;
ALTER TABLE marketplace.settlements
  DROP COLUMN fee_applies,
  DROP COLUMN commission_basis_points,
  DROP COLUMN goods_refunds_at_creation_minor,
  DROP COLUMN goods_minor;
