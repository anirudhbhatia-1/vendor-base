-- 10.3: a refund re-divides the order's money, and a shop can challenge the
-- line it is paid on.
--
-- Until audit run 68 the commission was charged once, at settlement, on what
-- the bags held at that moment: a refund after delivery took money back from
-- the customer and left the vendor's proceeds and the platform's fee standing
-- on goods that had been returned, so the shop was paid — and charged — for a
-- sale that was undone. An order cancelled after capture never settled at
-- all: the delivery fee the customer was told would be kept sat in platform
-- clearing, divided by nothing. And VEN-50, "vendors challenge a specific
-- ledger or payout line through a tracked finance case", existed nowhere: no
-- table, no service, no route, no screen.

-- What the settlement has already divided. `successful_refunds_minor` is the
-- refunds the settlement was built with; this is the total it has since been
-- re-divided for, so the sweep can tell an accounted refund from a new one.
ALTER TABLE marketplace.settlements
  ADD COLUMN redivided_refunds_minor bigint NOT NULL DEFAULT 0
    CHECK (redivided_refunds_minor >= 0),
  ADD COLUMN redivided_item_refunds_minor bigint NOT NULL DEFAULT 0
    CHECK (redivided_item_refunds_minor >= 0);

COMMENT ON COLUMN marketplace.settlements.redivided_refunds_minor IS
  'Refunds this settlement has been re-divided for, beyond the ones it was created with (10.3).';
COMMENT ON COLUMN marketplace.settlements.redivided_item_refunds_minor IS
  'The goods'' share of those refunds: what the commission was recalculated on (10.3).';

-- A shop challenging a settlement line (VEN-50). The partner's equivalent is
-- partner_dispute_cases (9.10); this is the same shape, addressed by the
-- settlement and the component rather than the earning.
CREATE TABLE marketplace.vendor_settlement_disputes (
  vendor_settlement_dispute_id uuid PRIMARY KEY,
  settlement_id uuid NOT NULL
    REFERENCES marketplace.settlements (settlement_id) ON DELETE RESTRICT,
  vendor_location_id uuid NOT NULL
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  raised_by_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  disputed_component text NOT NULL,
  disputed_amount_minor bigint NOT NULL,
  expected_amount_minor bigint NOT NULL,
  evidence_note text NOT NULL CHECK (length(evidence_note) BETWEEN 1 AND 500),
  lifecycle_state text NOT NULL DEFAULT 'OPEN',
  resolver_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  resolution_reason_code text,
  resolved_amount_minor bigint,
  deadline_at timestamptz NOT NULL,
  resolved_at timestamptz,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT vendor_dispute_component_allowed CHECK (disputed_component IN
    ('ITEM_PROCEEDS','PLATFORM_FEE','PAYMENT_FEE','TAX','REFUND','ADJUSTMENT')),
  CONSTRAINT vendor_dispute_amounts CHECK
    (disputed_amount_minor >= 0 AND expected_amount_minor >= 0),
  CONSTRAINT vendor_dispute_state_allowed CHECK
    (lifecycle_state IN ('OPEN','RESOLVED','WITHDRAWN')),
  CONSTRAINT vendor_dispute_resolution_shape CHECK (
    (lifecycle_state IN ('RESOLVED','WITHDRAWN'))
      = (resolved_at IS NOT NULL AND resolver_user_id IS NOT NULL)
    AND ((lifecycle_state = 'RESOLVED')
      = (resolution_reason_code IS NOT NULL AND resolved_amount_minor IS NOT NULL))
  ),
  CONSTRAINT vendor_dispute_reason_shape
    CHECK (resolution_reason_code IS NULL OR resolution_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

-- One open challenge per settlement line at a time, as the partner's is.
CREATE UNIQUE INDEX one_open_vendor_dispute_per_component
  ON marketplace.vendor_settlement_disputes (settlement_id, disputed_component)
  WHERE lifecycle_state = 'OPEN';
CREATE INDEX vendor_settlement_disputes_location
  ON marketplace.vendor_settlement_disputes (vendor_location_id, created_at);

-- A resolution at a different figure moves the settlement, and that movement
-- is posted once, keyed to the case — the partner adjustment's shape (0107).
CREATE TABLE marketplace.vendor_settlement_adjustments (
  vendor_settlement_adjustment_id uuid PRIMARY KEY,
  settlement_id uuid NOT NULL
    REFERENCES marketplace.settlements (settlement_id) ON DELETE RESTRICT,
  vendor_location_id uuid NOT NULL
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  vendor_settlement_dispute_id uuid NOT NULL UNIQUE
    REFERENCES marketplace.vendor_settlement_disputes (vendor_settlement_dispute_id) ON DELETE RESTRICT,
  delta_minor bigint NOT NULL CHECK (delta_minor <> 0),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  decided_by_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  ledger_transaction_id uuid
    REFERENCES marketplace.ledger_transactions (ledger_transaction_id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  posted_at timestamptz
);
CREATE INDEX vendor_settlement_adjustments_location
  ON marketplace.vendor_settlement_adjustments (vendor_location_id, created_at);

-- Append-only but for the posting stamp, exactly as the partner's is.
CREATE FUNCTION marketplace.protect_vendor_settlement_adjustments()
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
CREATE TRIGGER vendor_settlement_adjustments_append_only
BEFORE UPDATE OR DELETE ON marketplace.vendor_settlement_adjustments
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_vendor_settlement_adjustments();

INSERT INTO marketplace.capabilities
  (capability_key, actor_kind, resource_rule, description)
VALUES
  ('vendor.finance.dispute', 'VENDOR_STAFF', 'VENDOR_LOCATION',
    'Challenge a settlement line for an assigned vendor location'),
  ('admin.vendor_settlement.resolve', 'ADMIN', 'ADMIN_SCOPE',
    'Resolve a vendor settlement dispute and post its outcome');

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES
  ('VENDOR_OWNER', 'vendor.finance.dispute'),
  ('VENDOR_MANAGER', 'vendor.finance.dispute'),
  ('FINANCE_OPERATOR', 'admin.vendor_settlement.resolve'),
  ('FINANCE_APPROVER', 'admin.vendor_settlement.resolve');
