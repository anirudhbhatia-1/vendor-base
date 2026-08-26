INSERT INTO marketplace.capabilities
  (capability_key, actor_kind, resource_rule, description)
VALUES
  ('vendor.finance.read', 'VENDOR_STAFF', 'VENDOR_LOCATION', 'Read synthetic settlement records for an assigned vendor location'),
  ('partner.finance.read', 'PARTNER', 'PARTNER_SELF', 'Read the authenticated partner synthetic earnings and payouts'),
  ('admin.finance.ledger_manage', 'ADMIN', 'ADMIN_SCOPE', 'Manage synthetic payment, ledger, settlement, payout and reconciliation work');

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES
  ('VENDOR_OWNER', 'vendor.finance.read'),
  ('VENDOR_MANAGER', 'vendor.finance.read'),
  ('DELIVERY_PARTNER', 'partner.finance.read'),
  ('FINANCE_OPERATOR', 'admin.finance.ledger_manage'),
  ('FINANCE_APPROVER', 'admin.finance.ledger_manage');

CREATE TABLE marketplace.payment_transactions (
  payment_transaction_id uuid PRIMARY KEY,
  source_checkout_reference text NOT NULL UNIQUE,
  provider_operation_reference text NOT NULL UNIQUE,
  payment_state text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  provider_scenario text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT payment_checkout_reference_shape CHECK
    (source_checkout_reference ~ '^SYNTH-CHECKOUT-[A-Z0-9-]{4,64}$'),
  CONSTRAINT payment_operation_reference_shape CHECK
    (provider_operation_reference ~ '^SYNTH-PAY-[A-Z0-9-]{4,64}$'),
  CONSTRAINT payment_state_allowed CHECK (payment_state IN
    ('CREATED','AUTHORIZING','AUTHORIZED','CAPTURE_PENDING','CAPTURED',
     'FAILED','CANCELLED','UNKNOWN_REQUIRES_RECONCILIATION')),
  CONSTRAINT payment_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT payment_currency_inr CHECK (currency = 'INR'),
  CONSTRAINT payment_provider_scenario_allowed CHECK
    (provider_scenario IN ('SUCCESS','DECLINE','UNKNOWN','MALFORMED')),
  CONSTRAINT payment_version_positive CHECK (version >= 1)
);

CREATE TABLE marketplace.payment_allocations (
  payment_allocation_id uuid PRIMARY KEY,
  payment_transaction_id uuid NOT NULL,
  source_order_reference text NOT NULL,
  vendor_location_id uuid NOT NULL,
  item_minor bigint NOT NULL,
  tax_minor bigint NOT NULL,
  delivery_minor bigint NOT NULL,
  tip_minor bigint NOT NULL,
  discount_minor bigint NOT NULL,
  allocated_total_minor bigint GENERATED ALWAYS AS
    (item_minor + tax_minor + delivery_minor + tip_minor - discount_minor) STORED,
  policy_version_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT payment_allocation_payment_fk FOREIGN KEY (payment_transaction_id)
    REFERENCES marketplace.payment_transactions (payment_transaction_id) ON DELETE RESTRICT,
  CONSTRAINT payment_allocation_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT payment_allocation_order_shape CHECK
    (source_order_reference ~ '^SYNTH-ORDER-[A-Z0-9-]{4,64}$'),
  CONSTRAINT payment_allocation_policy_shape CHECK
    (policy_version_reference ~ '^SYNTH-POLICY-[A-Z0-9-]{4,64}$'),
  CONSTRAINT payment_allocation_components CHECK
    (item_minor >= 0 AND tax_minor >= 0 AND delivery_minor >= 0 AND tip_minor >= 0
     AND discount_minor >= 0 AND item_minor + tax_minor + delivery_minor + tip_minor >= discount_minor),
  CONSTRAINT payment_allocation_order_unique UNIQUE (payment_transaction_id, source_order_reference)
);

CREATE TABLE marketplace.payment_events (
  payment_event_id uuid PRIMARY KEY,
  payment_transaction_id uuid NOT NULL,
  payment_version integer NOT NULL,
  event_type text NOT NULL,
  previous_state text,
  resulting_state text NOT NULL,
  provider_result text,
  command_reference text NOT NULL UNIQUE,
  actor_id uuid NOT NULL,
  actor_kind text NOT NULL,
  reason_code text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT payment_event_payment_fk FOREIGN KEY (payment_transaction_id)
    REFERENCES marketplace.payment_transactions (payment_transaction_id) ON DELETE RESTRICT,
  CONSTRAINT payment_event_version_unique UNIQUE (payment_transaction_id, payment_version),
  CONSTRAINT payment_event_command_shape CHECK (command_reference ~ '^SYNTH-CMD-[A-Z0-9-]{4,64}$'),
  CONSTRAINT payment_event_reason_shape CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

CREATE TABLE marketplace.refunds (
  refund_id uuid PRIMARY KEY,
  payment_transaction_id uuid NOT NULL,
  source_order_reference text NOT NULL,
  provider_operation_reference text NOT NULL UNIQUE,
  refund_state text NOT NULL,
  trigger_code text NOT NULL,
  item_minor bigint NOT NULL,
  tax_minor bigint NOT NULL,
  delivery_minor bigint NOT NULL,
  tip_minor bigint NOT NULL,
  discount_reversal_minor bigint NOT NULL,
  refund_total_minor bigint GENERATED ALWAYS AS
    (item_minor + tax_minor + delivery_minor + tip_minor - discount_reversal_minor) STORED,
  proposed_by_user_id uuid NOT NULL,
  approved_by_user_id uuid,
  approval_expires_at timestamptz,
  provider_scenario text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT refund_payment_fk FOREIGN KEY (payment_transaction_id)
    REFERENCES marketplace.payment_transactions (payment_transaction_id) ON DELETE RESTRICT,
  CONSTRAINT refund_proposer_fk FOREIGN KEY (proposed_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT refund_approver_fk FOREIGN KEY (approved_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT refund_order_shape CHECK (source_order_reference ~ '^SYNTH-ORDER-[A-Z0-9-]{4,64}$'),
  CONSTRAINT refund_operation_shape CHECK (provider_operation_reference ~ '^SYNTH-REF-[A-Z0-9-]{4,64}$'),
  CONSTRAINT refund_state_allowed CHECK (refund_state IN
    ('REQUESTED','PENDING_APPROVAL','SUBMITTED','SUCCEEDED','FAILED_RETRYABLE','FAILED_REVIEW')),
  CONSTRAINT refund_trigger_allowed CHECK (trigger_code IN
    ('PRE_PICKUP_CANCEL','CONTROLLED_RETURN','PARTIAL_ITEM_REFUND','FULL_ITEM_REFUND','PROVIDER_EXCEPTION')),
  CONSTRAINT refund_components CHECK
    (item_minor >= 0 AND tax_minor >= 0 AND delivery_minor >= 0 AND tip_minor >= 0
     AND discount_reversal_minor >= 0
     AND item_minor + tax_minor + delivery_minor + tip_minor > discount_reversal_minor),
  CONSTRAINT refund_approval_shape CHECK
    ((refund_state IN ('REQUESTED','PENDING_APPROVAL') AND approved_by_user_id IS NULL)
     OR (refund_state NOT IN ('REQUESTED','PENDING_APPROVAL') AND approved_by_user_id IS NOT NULL)),
  CONSTRAINT refund_maker_checker CHECK
    (approved_by_user_id IS NULL OR approved_by_user_id <> proposed_by_user_id),
  CONSTRAINT refund_provider_scenario_allowed CHECK
    (provider_scenario IN ('SUCCESS','DECLINE','UNKNOWN','MALFORMED'))
);

CREATE TABLE marketplace.refund_events (
  refund_event_id uuid PRIMARY KEY,
  refund_id uuid NOT NULL,
  refund_version integer NOT NULL,
  event_type text NOT NULL,
  previous_state text,
  resulting_state text NOT NULL,
  actor_id uuid NOT NULL,
  reason_code text NOT NULL,
  command_reference text NOT NULL UNIQUE,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT refund_event_refund_fk FOREIGN KEY (refund_id)
    REFERENCES marketplace.refunds (refund_id) ON DELETE RESTRICT,
  CONSTRAINT refund_event_version_unique UNIQUE (refund_id, refund_version),
  CONSTRAINT refund_event_command_shape CHECK (command_reference ~ '^SYNTH-CMD-[A-Z0-9-]{4,64}$')
);

CREATE TABLE marketplace.ledger_transactions (
  ledger_transaction_id uuid PRIMARY KEY,
  source_reference text NOT NULL UNIQUE,
  transaction_kind text NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  posted_at timestamptz NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  CONSTRAINT ledger_source_shape CHECK (source_reference ~ '^SYNTH-(CAPTURE|REFUND|SETTLEMENT|PAYOUT|ADJUSTMENT)-[A-Z0-9-]{4,64}$'),
  CONSTRAINT ledger_kind_allowed CHECK
    (transaction_kind IN ('CAPTURE','REFUND','SETTLEMENT','PAYOUT','REVERSAL','ADJUSTMENT')),
  CONSTRAINT ledger_currency_inr CHECK (currency = 'INR')
);

CREATE TABLE marketplace.ledger_entries (
  ledger_entry_id uuid PRIMARY KEY,
  ledger_transaction_id uuid NOT NULL,
  account_reference text NOT NULL,
  component text NOT NULL,
  debit_minor bigint NOT NULL DEFAULT 0,
  credit_minor bigint NOT NULL DEFAULT 0,
  vendor_location_id uuid,
  partner_user_id uuid,
  source_order_reference text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ledger_entry_transaction_fk FOREIGN KEY (ledger_transaction_id)
    REFERENCES marketplace.ledger_transactions (ledger_transaction_id) ON DELETE RESTRICT,
  CONSTRAINT ledger_entry_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT ledger_entry_partner_fk FOREIGN KEY (partner_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT ledger_entry_account_shape CHECK (account_reference ~ '^SYNTH-ACCOUNT-[A-Z0-9-]{3,64}$'),
  CONSTRAINT ledger_entry_component_allowed CHECK (component IN
    ('CUSTOMER_CAPTURE','CUSTOMER_REFUND','VENDOR_PROCEEDS','VENDOR_FEE',
     'PARTNER_OUTBOUND','PARTNER_WAIT','PARTNER_RETURN','PARTNER_TIP',
     'PLATFORM_REMAINDER','PAYOUT','ADJUSTMENT')),
  CONSTRAINT ledger_entry_one_side CHECK
    ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
  CONSTRAINT ledger_entry_order_shape CHECK
    (source_order_reference IS NULL OR source_order_reference ~ '^SYNTH-ORDER-[A-Z0-9-]{4,64}$')
);

CREATE TABLE marketplace.settlements (
  settlement_id uuid PRIMARY KEY,
  source_order_reference text NOT NULL UNIQUE,
  payment_transaction_id uuid NOT NULL,
  vendor_location_id uuid NOT NULL,
  partner_user_id uuid,
  settlement_state text NOT NULL,
  customer_captured_minor bigint NOT NULL,
  successful_refunds_minor bigint NOT NULL,
  customer_net_minor bigint NOT NULL,
  vendor_payable_minor bigint NOT NULL,
  partner_payable_minor bigint NOT NULL,
  platform_remainder_minor bigint NOT NULL,
  hold_minor bigint NOT NULL DEFAULT 0,
  hold_reason_code text,
  eligible_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT settlement_payment_fk FOREIGN KEY (payment_transaction_id)
    REFERENCES marketplace.payment_transactions (payment_transaction_id) ON DELETE RESTRICT,
  CONSTRAINT settlement_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT settlement_partner_fk FOREIGN KEY (partner_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT settlement_order_shape CHECK (source_order_reference ~ '^SYNTH-ORDER-[A-Z0-9-]{4,64}$'),
  CONSTRAINT settlement_state_allowed CHECK
    (settlement_state IN ('PENDING','ELIGIBLE','SCHEDULED','SUBMITTED','PAID','HELD','FAILED_REVIEW')),
  CONSTRAINT settlement_balance CHECK
    (customer_net_minor = customer_captured_minor - successful_refunds_minor
     AND customer_net_minor = vendor_payable_minor + partner_payable_minor + platform_remainder_minor),
  CONSTRAINT settlement_amounts CHECK
    (customer_captured_minor >= 0 AND successful_refunds_minor >= 0
     AND vendor_payable_minor >= 0 AND partner_payable_minor >= 0 AND hold_minor >= 0),
  CONSTRAINT settlement_hold_shape CHECK
    ((settlement_state = 'HELD' AND hold_minor > 0 AND hold_reason_code IS NOT NULL)
     OR (settlement_state <> 'HELD' AND hold_minor = 0 AND hold_reason_code IS NULL))
);

CREATE TABLE marketplace.payouts (
  payout_id uuid PRIMARY KEY,
  settlement_id uuid NOT NULL,
  beneficiary_kind text NOT NULL,
  beneficiary_reference text NOT NULL,
  provider_operation_reference text NOT NULL UNIQUE,
  payout_state text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  provider_scenario text NOT NULL,
  statement_reference text,
  version integer NOT NULL DEFAULT 1,
  submitted_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT payout_settlement_fk FOREIGN KEY (settlement_id)
    REFERENCES marketplace.settlements (settlement_id) ON DELETE RESTRICT,
  CONSTRAINT payout_beneficiary_kind CHECK (beneficiary_kind IN ('VENDOR','PARTNER')),
  CONSTRAINT payout_beneficiary_shape CHECK (beneficiary_reference ~ '^SYNTH-BENEFICIARY-[A-Z0-9-]{4,64}$'),
  CONSTRAINT payout_operation_shape CHECK (provider_operation_reference ~ '^SYNTH-PAYOUT-[A-Z0-9-]{4,64}$'),
  CONSTRAINT payout_state_allowed CHECK
    (payout_state IN ('PENDING','SCHEDULED','SUBMITTED','PAID','HELD','FAILED_REVIEW')),
  CONSTRAINT payout_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT payout_currency_inr CHECK (currency = 'INR'),
  CONSTRAINT payout_provider_scenario_allowed CHECK
    (provider_scenario IN ('SUCCESS','DECLINE','UNKNOWN','MALFORMED'))
);

CREATE TABLE marketplace.provider_statement_rows (
  statement_row_id uuid PRIMARY KEY,
  provider_operation_reference text NOT NULL UNIQUE,
  statement_reference text NOT NULL,
  operation_kind text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  provider_state text NOT NULL,
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT statement_reference_shape CHECK (statement_reference ~ '^SYNTH-STMT-[A-Z0-9-]{4,64}$'),
  CONSTRAINT statement_kind_allowed CHECK (operation_kind IN ('PAYMENT','REFUND','PAYOUT')),
  CONSTRAINT statement_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT statement_currency_inr CHECK (currency = 'INR'),
  CONSTRAINT statement_state_allowed CHECK (provider_state IN ('SUCCEEDED','FAILED','UNKNOWN'))
);

CREATE TABLE marketplace.finance_exceptions (
  finance_exception_id uuid PRIMARY KEY,
  exception_kind text NOT NULL,
  operation_reference text NOT NULL,
  amount_at_risk_minor bigint NOT NULL,
  exception_state text NOT NULL DEFAULT 'OPEN',
  owner_reference text,
  next_action_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT finance_exception_kind_allowed CHECK (exception_kind IN
    ('PAYMENT_UNKNOWN','REFUND_UNKNOWN','PAYOUT_UNKNOWN','STATEMENT_MISSING','STATEMENT_CONFLICT','LEDGER_UNBALANCED')),
  CONSTRAINT finance_exception_amount CHECK (amount_at_risk_minor >= 0),
  CONSTRAINT finance_exception_state_allowed CHECK (exception_state IN ('OPEN','ASSIGNED','RESOLVED')),
  CONSTRAINT finance_exception_next_action_shape CHECK (next_action_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

CREATE INDEX payments_state_age ON marketplace.payment_transactions (payment_state, updated_at, payment_transaction_id);
CREATE INDEX refunds_state_age ON marketplace.refunds (refund_state, updated_at, refund_id);
CREATE INDEX settlements_eligibility ON marketplace.settlements (settlement_state, eligible_at, settlement_id);
CREATE INDEX payouts_state_age ON marketplace.payouts (payout_state, updated_at, payout_id);
CREATE INDEX ledger_entries_order ON marketplace.ledger_entries (source_order_reference, created_at, ledger_entry_id);
CREATE INDEX finance_exceptions_queue ON marketplace.finance_exceptions (exception_state, created_at, finance_exception_id);

CREATE FUNCTION marketplace.ensure_ledger_transaction_balanced()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid;
DECLARE difference bigint;
BEGIN
  target_id := COALESCE(NEW.ledger_transaction_id, OLD.ledger_transaction_id);
  SELECT COALESCE(sum(debit_minor),0) - COALESCE(sum(credit_minor),0)
    INTO difference FROM marketplace.ledger_entries
   WHERE ledger_transaction_id = target_id;
  IF difference <> 0 THEN
    RAISE EXCEPTION 'ledger transaction is unbalanced' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_transaction_balanced
AFTER INSERT OR UPDATE OR DELETE ON marketplace.ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION marketplace.ensure_ledger_transaction_balanced();

CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON marketplace.payment_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_assignment_history();
CREATE TRIGGER refund_events_append_only BEFORE UPDATE OR DELETE ON marketplace.refund_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_assignment_history();
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON marketplace.ledger_transactions
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_assignment_history();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON marketplace.ledger_entries
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_assignment_history();

COMMENT ON TABLE marketplace.payment_transactions IS 'Synthetic fake-provider operations only; stores no instrument, UPI, bank, card, or real provider data.';
COMMENT ON TABLE marketplace.ledger_entries IS 'Append-only balanced INR-paise test ledger; production accounting and tax authority remain blocked.';
COMMENT ON TABLE marketplace.payouts IS 'Fake payout operations using fictional beneficiary tokens only.';
