-- 9.10: a dispute's outcome is money on the earning, attributable to the
-- dispute, and posted to the ledger.
--
-- Until audit run 65 a resolved dispute recorded a "resolved amount" on the
-- case and changed nothing on the earning or in the ledger: the partner was
-- told an answer and paid the old figure.

CREATE TABLE marketplace.partner_earning_adjustments (
  partner_earning_adjustment_id uuid PRIMARY KEY,
  partner_earnings_record_id uuid NOT NULL,
  partner_user_id uuid NOT NULL,
  partner_dispute_case_id uuid NOT NULL UNIQUE,
  delta_minor bigint NOT NULL,
  reason_code text NOT NULL,
  decided_by_user_id uuid NOT NULL,
  ledger_transaction_id uuid,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  posted_at timestamptz,
  CONSTRAINT partner_earning_adjustment_record_fk FOREIGN KEY (partner_earnings_record_id)
    REFERENCES marketplace.partner_earnings_records (partner_earnings_record_id) ON DELETE RESTRICT,
  CONSTRAINT partner_earning_adjustment_partner_fk FOREIGN KEY (partner_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT partner_earning_adjustment_dispute_fk FOREIGN KEY (partner_dispute_case_id)
    REFERENCES marketplace.partner_dispute_cases (partner_dispute_case_id) ON DELETE RESTRICT,
  CONSTRAINT partner_earning_adjustment_decider_fk FOREIGN KEY (decided_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT partner_earning_adjustment_ledger_fk FOREIGN KEY (ledger_transaction_id)
    REFERENCES marketplace.ledger_transactions (ledger_transaction_id) ON DELETE RESTRICT,
  CONSTRAINT partner_earning_adjustment_delta CHECK
    (delta_minor <> 0 AND delta_minor BETWEEN -1000000 AND 1000000),
  CONSTRAINT partner_earning_adjustment_reason_shape CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT partner_earning_adjustment_posting_shape CHECK
    ((ledger_transaction_id IS NULL) = (posted_at IS NULL))
);

CREATE INDEX partner_earning_adjustments_unposted
  ON marketplace.partner_earning_adjustments (created_at)
  WHERE ledger_transaction_id IS NULL;
CREATE INDEX partner_earning_adjustments_partner
  ON marketplace.partner_earning_adjustments (partner_user_id, created_at DESC);

-- Append-only apart from the posting stamp: the delta, once decided, stands.
CREATE FUNCTION marketplace.protect_partner_earning_adjustments() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'partner earning adjustments are append-only' USING ERRCODE = '55000';
  END IF;
  IF NEW.partner_earning_adjustment_id <> OLD.partner_earning_adjustment_id
     OR NEW.partner_earnings_record_id <> OLD.partner_earnings_record_id
     OR NEW.partner_user_id <> OLD.partner_user_id
     OR NEW.partner_dispute_case_id <> OLD.partner_dispute_case_id
     OR NEW.delta_minor <> OLD.delta_minor
     OR NEW.reason_code <> OLD.reason_code
     OR NEW.decided_by_user_id <> OLD.decided_by_user_id
     OR NEW.created_at <> OLD.created_at
     OR OLD.ledger_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'partner earning adjustments are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER partner_earning_adjustments_append_only
BEFORE UPDATE OR DELETE ON marketplace.partner_earning_adjustments
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_partner_earning_adjustments();
