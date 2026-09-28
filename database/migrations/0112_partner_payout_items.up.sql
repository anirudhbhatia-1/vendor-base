-- 10.4: a partner is paid what they earned, once, in one payout per batch
-- that names what it pays.
--
-- Until audit run 69 a partner payout was a per-order item keyed to the
-- order's settlement, and the settlement's single state was shared with the
-- shop's payout: the daily run paid shops first and moved each settlement to
-- SCHEDULED, and the partner run then looked only for PENDING or ELIGIBLE
-- settlements, so a partner was never paid for any order that also paid a
-- shop. What a partner earned outside a settlement — a dispute's answer, a
-- reassignment's compensation, the trip out to a delivery that came back —
-- reached no payout at all, and a compensation never reached the books.

-- A partner payout is the partner's, not an order's: it names the partner and
-- needs no settlement. A shop's payout still clears exactly one settlement.
ALTER TABLE marketplace.payouts
  ALTER COLUMN settlement_id DROP NOT NULL,
  ADD COLUMN partner_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT;
UPDATE marketplace.payouts payout
   SET partner_user_id = settlement.partner_user_id
  FROM marketplace.settlements settlement
 WHERE settlement.settlement_id = payout.settlement_id
   AND payout.beneficiary_kind = 'PARTNER';
ALTER TABLE marketplace.payouts
  ADD CONSTRAINT payout_beneficiary_owner CHECK (
    (beneficiary_kind = 'VENDOR' AND settlement_id IS NOT NULL AND partner_user_id IS NULL)
    OR (beneficiary_kind = 'PARTNER' AND partner_user_id IS NOT NULL)),
  ADD CONSTRAINT payout_partner_identity UNIQUE (payout_id, partner_user_id);
CREATE INDEX payouts_partner
  ON marketplace.payouts (partner_user_id, created_at DESC) WHERE partner_user_id IS NOT NULL;

-- A reassignment's compensation (9.3) is money owed to the displaced partner;
-- it is posted once, and the row carries the stamp.
ALTER TABLE marketplace.partner_attempt_compensations
  ADD COLUMN ledger_transaction_id uuid
    REFERENCES marketplace.ledger_transactions (ledger_transaction_id) ON DELETE RESTRICT,
  ADD COLUMN posted_at timestamptz,
  ADD CONSTRAINT partner_attempt_compensation_posting_shape
    CHECK ((ledger_transaction_id IS NULL) = (posted_at IS NULL));
CREATE INDEX partner_attempt_compensations_unposted
  ON marketplace.partner_attempt_compensations (created_at)
  WHERE ledger_transaction_id IS NULL AND amount_minor > 0;

-- Append-only but for the posting stamp, written once.
CREATE OR REPLACE FUNCTION marketplace.protect_partner_attempt_compensations()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR OLD.ledger_transaction_id IS NOT NULL
     OR NEW.partner_attempt_compensation_id <> OLD.partner_attempt_compensation_id
     OR NEW.delivery_assignment_id <> OLD.delivery_assignment_id
     OR NEW.partner_user_id <> OLD.partner_user_id
     OR NEW.decided_by_user_id <> OLD.decided_by_user_id
     OR NEW.displaced_from <> OLD.displaced_from
     OR NEW.amount_minor <> OLD.amount_minor
     OR NEW.reason_code <> OLD.reason_code
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'partner attempt compensations are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- What a partner payout pays: each earning, dispute answer and compensation
-- it carries, at the amount that source put on the partner's payable. A
-- source is on at most one live payout; it becomes payable again only when a
-- person releases it from a payout the bank refused. A payout whose outcome
-- is unknown keeps its items, so nothing it may have paid is paid twice.
CREATE TABLE marketplace.partner_payout_items (
  partner_payout_item_id uuid PRIMARY KEY,
  payout_id uuid NOT NULL,
  partner_user_id uuid NOT NULL,
  source_kind text NOT NULL,
  partner_earnings_record_id uuid
    REFERENCES marketplace.partner_earnings_records (partner_earnings_record_id) ON DELETE RESTRICT,
  partner_earning_adjustment_id uuid
    REFERENCES marketplace.partner_earning_adjustments (partner_earning_adjustment_id) ON DELETE RESTRICT,
  partner_attempt_compensation_id uuid
    REFERENCES marketplace.partner_attempt_compensations (partner_attempt_compensation_id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'PAYING',
  released_by_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  release_reason_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  -- The item's partner is its payout's partner.
  CONSTRAINT partner_payout_item_payout_fk FOREIGN KEY (payout_id, partner_user_id)
    REFERENCES marketplace.payouts (payout_id, partner_user_id) ON DELETE RESTRICT,
  CONSTRAINT partner_payout_item_kind CHECK (source_kind IN ('EARNING','ADJUSTMENT','COMPENSATION')),
  CONSTRAINT partner_payout_item_source_shape CHECK (
    (source_kind = 'EARNING') = (partner_earnings_record_id IS NOT NULL)
    AND (source_kind = 'ADJUSTMENT') = (partner_earning_adjustment_id IS NOT NULL)
    AND (source_kind = 'COMPENSATION') = (partner_attempt_compensation_id IS NOT NULL)),
  -- A dispute answered below the line is money the partner owes back, and is
  -- recovered from the payout that carries it; everything else is owed to them.
  CONSTRAINT partner_payout_item_amount CHECK (
    amount_minor > 0 OR (source_kind = 'ADJUSTMENT' AND amount_minor < 0)),
  CONSTRAINT partner_payout_item_state CHECK (lifecycle_state IN ('PAYING','PAID','RELEASED')),
  CONSTRAINT partner_payout_item_settled_shape CHECK ((lifecycle_state = 'PAYING') = (settled_at IS NULL)),
  CONSTRAINT partner_payout_item_release_shape CHECK (
    (lifecycle_state = 'RELEASED') = (released_by_user_id IS NOT NULL AND release_reason_code IS NOT NULL)),
  CONSTRAINT partner_payout_item_reason_shape CHECK (
    release_reason_code IS NULL OR release_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);
CREATE UNIQUE INDEX partner_payout_items_live_earning
  ON marketplace.partner_payout_items (partner_earnings_record_id)
  WHERE lifecycle_state <> 'RELEASED' AND partner_earnings_record_id IS NOT NULL;
CREATE UNIQUE INDEX partner_payout_items_live_adjustment
  ON marketplace.partner_payout_items (partner_earning_adjustment_id)
  WHERE lifecycle_state <> 'RELEASED' AND partner_earning_adjustment_id IS NOT NULL;
CREATE UNIQUE INDEX partner_payout_items_live_compensation
  ON marketplace.partner_payout_items (partner_attempt_compensation_id)
  WHERE lifecycle_state <> 'RELEASED' AND partner_attempt_compensation_id IS NOT NULL;
CREATE INDEX partner_payout_items_payout ON marketplace.partner_payout_items (payout_id);
CREATE INDEX partner_payout_items_partner
  ON marketplace.partner_payout_items (partner_user_id, created_at DESC);

-- An item's source and amount never change; its state moves once, from
-- PAYING to PAID or RELEASED.
CREATE FUNCTION marketplace.protect_partner_payout_items() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR OLD.lifecycle_state <> 'PAYING'
     OR NEW.partner_payout_item_id <> OLD.partner_payout_item_id
     OR NEW.payout_id <> OLD.payout_id
     OR NEW.partner_user_id <> OLD.partner_user_id
     OR NEW.source_kind <> OLD.source_kind
     OR NEW.partner_earnings_record_id IS DISTINCT FROM OLD.partner_earnings_record_id
     OR NEW.partner_earning_adjustment_id IS DISTINCT FROM OLD.partner_earning_adjustment_id
     OR NEW.partner_attempt_compensation_id IS DISTINCT FROM OLD.partner_attempt_compensation_id
     OR NEW.amount_minor <> OLD.amount_minor
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'partner payout items are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER partner_payout_items_append_only
BEFORE UPDATE OR DELETE ON marketplace.partner_payout_items
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_partner_payout_items();

-- A partner payout pays exactly what its items add up to, checked when the
-- transaction that wrote them commits.
CREATE FUNCTION marketplace.ensure_partner_payout_matches_items() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE expected bigint;
DECLARE items bigint;
BEGIN
  SELECT amount_minor INTO expected FROM marketplace.payouts WHERE payout_id = NEW.payout_id;
  SELECT COALESCE(sum(amount_minor), 0) INTO items
    FROM marketplace.partner_payout_items WHERE payout_id = NEW.payout_id;
  IF expected IS DISTINCT FROM items THEN
    RAISE EXCEPTION 'partner payout % pays % but its items add up to %', NEW.payout_id, expected, items
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER partner_payout_items_sum
AFTER INSERT ON marketplace.partner_payout_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION marketplace.ensure_partner_payout_matches_items();

-- A payout the bank refused is a case for a person: the partner's bank
-- details are checked before what it carried is released to be paid again.
ALTER TABLE marketplace.finance_exceptions DROP CONSTRAINT finance_exception_kind_allowed;
ALTER TABLE marketplace.finance_exceptions ADD CONSTRAINT finance_exception_kind_allowed CHECK (exception_kind IN
  ('PAYMENT_UNKNOWN','REFUND_UNKNOWN','PAYOUT_UNKNOWN','STATEMENT_MISSING','STATEMENT_CONFLICT',
   'STATEMENT_UNMATCHED','STATEMENT_DUPLICATE','AMOUNT_MISMATCH','STATUS_MISMATCH',
   'LEDGER_UNBALANCED','PAYOUT_DUPLICATE_RISK','CORRECTION_REVIEW',
   'SETTLEMENT_MISMATCH','POSTING_FAILED','PAYOUT_FAILED'));
