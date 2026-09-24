-- 10.3, corrected: a settlement keeps what its division was made from.
--
-- 0110's re-division recomputed the commission from the financial policy in
-- force when the settlement was *written*, not the one the order was quoted
-- under; charged commission on orders settled without it (a cancelled or
-- failed order); and counted a refund taken before the settlement as if it
-- were new, taking its goods off the shop a second time. The division is now
-- one pure function (`settlement-division.ts`) fed from this snapshot, so a
-- later refund re-divides from the same inputs the settlement was made from.

ALTER TABLE marketplace.settlements
  ADD COLUMN goods_minor bigint CHECK (goods_minor IS NULL OR goods_minor >= 0),
  ADD COLUMN goods_refunds_at_creation_minor bigint
    CHECK (goods_refunds_at_creation_minor IS NULL OR goods_refunds_at_creation_minor >= 0),
  ADD COLUMN commission_basis_points integer
    CHECK (commission_basis_points IS NULL OR commission_basis_points BETWEEN 0 AND 10000),
  ADD COLUMN fee_applies boolean;

COMMENT ON COLUMN marketplace.settlements.goods_minor IS
  'The shop''s goods as sold, before any return: the base the commission is a rate on (10.3).';
COMMENT ON COLUMN marketplace.settlements.goods_refunds_at_creation_minor IS
  'The goods'' share of the refunds the settlement was created with (10.3).';
COMMENT ON COLUMN marketplace.settlements.commission_basis_points IS
  'The commission rate of the policy the order was quoted under, as the settlement applied it.';
COMMENT ON COLUMN marketplace.settlements.fee_applies IS
  'Whether the order completed and so pays the vendor fee at all.';

-- Backfill what the settlement's own creation lines can prove, and nothing
-- more: a settlement written before this migration took every refund it was
-- created with off the goods, so goods = the creation proceeds line plus those
-- refunds whenever the line is positive. A row whose goods were clipped to
-- zero, or whose policy cannot be found, is left NULL; the re-division then
-- refuses it with a finance exception rather than guessing.
WITH creation AS (
  SELECT settlement.settlement_id,
         settlement.successful_refunds_minor - settlement.redivided_refunds_minor AS refunds_at_creation,
         (SELECT COALESCE(sum(line.amount_minor), 0) FROM marketplace.settlement_lines line
           WHERE line.settlement_id = settlement.settlement_id
             AND line.component = 'ITEM_PROCEEDS'
             AND line.created_at = settlement.created_at) AS proceeds,
         (SELECT COALESCE(sum(line.amount_minor), 0) FROM marketplace.settlement_lines line
           WHERE line.settlement_id = settlement.settlement_id
             AND line.component = 'PLATFORM_FEE'
             AND line.created_at = settlement.created_at) AS fee,
         (SELECT line.policy_version_reference FROM marketplace.settlement_lines line
           WHERE line.settlement_id = settlement.settlement_id
           ORDER BY line.created_at, line.settlement_line_id LIMIT 1) AS policy_reference
    FROM marketplace.settlements settlement
), policy AS (
  SELECT creation.settlement_id,
         (SELECT (version.configuration_value ->> 'commission_basis_points')::integer
            FROM marketplace.configuration_versions version
           WHERE version.configuration_key = 'finance.financial_policy'
             AND creation.policy_reference =
                 'SYNTH-POLICY-FIN-V' || version.version_number || '-' ||
                 upper(left(replace(version.configuration_version_id::text, '-', ''), 8))
           LIMIT 1) AS basis_points
    FROM creation
)
UPDATE marketplace.settlements settlement
   SET goods_minor = CASE
         WHEN creation.proceeds > 0 OR creation.refunds_at_creation = 0
           THEN creation.proceeds + creation.refunds_at_creation
       END,
       goods_refunds_at_creation_minor = creation.refunds_at_creation,
       fee_applies = creation.fee > 0,
       commission_basis_points = policy.basis_points
  FROM creation JOIN policy USING (settlement_id)
 WHERE settlement.settlement_id = creation.settlement_id;

-- The re-division sweep and the settlement's refund totals read refunds by
-- order; without this every worker tick scanned the table once per settlement.
CREATE INDEX refunds_order_state
  ON marketplace.refunds (source_order_reference, refund_state);

-- A settlement a refund reached after its payout was fixed, or that cannot be
-- re-divided safely, is a vendor settlement mismatch (11.5) for a person; an
-- adjustment the sweep could not post is a posting failure.
ALTER TABLE marketplace.finance_exceptions DROP CONSTRAINT finance_exception_kind_allowed;
ALTER TABLE marketplace.finance_exceptions ADD CONSTRAINT finance_exception_kind_allowed CHECK (exception_kind IN
  ('PAYMENT_UNKNOWN','REFUND_UNKNOWN','PAYOUT_UNKNOWN','STATEMENT_MISSING','STATEMENT_CONFLICT',
   'STATEMENT_UNMATCHED','STATEMENT_DUPLICATE','AMOUNT_MISMATCH','STATUS_MISMATCH',
   'LEDGER_UNBALANCED','PAYOUT_DUPLICATE_RISK','CORRECTION_REVIEW',
   'SETTLEMENT_MISMATCH','POSTING_FAILED'));

CREATE INDEX finance_exceptions_open_operation
  ON marketplace.finance_exceptions (exception_kind, operation_reference)
  WHERE exception_state IN ('OPEN', 'ASSIGNED');

-- A shop's challenge answered after its payout was fixed (VEN-50) cannot move
-- the settlement: the batch has already written the amount it pays. The
-- adjustment is still decided, recorded and posted — the vendor payable in
-- the books then holds what is owed — and it is paid separately, which a
-- finance exception asks a person to do. `false` marks that kind.
ALTER TABLE marketplace.vendor_settlement_adjustments
  ADD COLUMN applied_to_settlement boolean NOT NULL DEFAULT true;

-- The guard 0110 installed let an unposted adjustment's vendor, request and
-- correlation be rewritten; the posting names the vendor from that row, so
-- the owner of the money could be changed before it reached the books.
CREATE OR REPLACE FUNCTION marketplace.protect_vendor_settlement_adjustments()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vendor settlement adjustments are append-only' USING ERRCODE = '55000';
  END IF;
  IF OLD.ledger_transaction_id IS NOT NULL
     OR NEW.vendor_settlement_adjustment_id <> OLD.vendor_settlement_adjustment_id
     OR NEW.settlement_id <> OLD.settlement_id
     OR NEW.vendor_location_id <> OLD.vendor_location_id
     OR NEW.vendor_settlement_dispute_id <> OLD.vendor_settlement_dispute_id
     OR NEW.delta_minor <> OLD.delta_minor
     OR NEW.reason_code <> OLD.reason_code
     OR NEW.decided_by_user_id <> OLD.decided_by_user_id
     OR NEW.request_id <> OLD.request_id
     OR NEW.correlation_id <> OLD.correlation_id
     OR NEW.created_at <> OLD.created_at
     OR NEW.applied_to_settlement <> OLD.applied_to_settlement THEN
    RAISE EXCEPTION 'vendor settlement adjustments are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
