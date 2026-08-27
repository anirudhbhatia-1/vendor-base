-- Phase 10: complete the synthetic, provider-neutral money lifecycle without
-- changing any previously applied financial history.

CREATE TABLE marketplace.ledger_accounts (
  account_reference text PRIMARY KEY,
  account_type text NOT NULL,
  owner_kind text NOT NULL,
  normal_side text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR',
  vendor_location_id uuid REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  partner_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ledger_account_reference_shape CHECK (account_reference ~ '^SYNTH-ACCOUNT-[A-Z0-9-]{3,64}$'),
  CONSTRAINT ledger_account_type_allowed CHECK (account_type IN
    ('ASSET','LIABILITY','REVENUE','EXPENSE','CLEARING')),
  CONSTRAINT ledger_account_owner_allowed CHECK (owner_kind IN
    ('CUSTOMER_POOL','VENDOR','PARTNER','PLATFORM','PROVIDER','TAX_AUTHORITY')),
  CONSTRAINT ledger_account_side_allowed CHECK (normal_side IN ('DEBIT','CREDIT')),
  CONSTRAINT ledger_account_currency CHECK (currency='INR'),
  CONSTRAINT ledger_account_state_allowed CHECK (lifecycle_state IN ('ACTIVE','CLOSED')),
  CONSTRAINT ledger_account_owner_shape CHECK (
    (owner_kind='VENDOR' AND vendor_location_id IS NOT NULL AND partner_user_id IS NULL)
    OR (owner_kind='PARTNER' AND partner_user_id IS NOT NULL AND vendor_location_id IS NULL)
    OR (owner_kind NOT IN ('VENDOR','PARTNER') AND vendor_location_id IS NULL AND partner_user_id IS NULL)
  )
);

INSERT INTO marketplace.ledger_accounts
  (account_reference,account_type,owner_kind,normal_side)
VALUES
  ('SYNTH-ACCOUNT-CUSTOMER-CLEARING','CLEARING','CUSTOMER_POOL','DEBIT'),
  ('SYNTH-ACCOUNT-PLATFORM-CLEARING','CLEARING','PLATFORM','DEBIT'),
  ('SYNTH-ACCOUNT-PLATFORM-REVENUE','REVENUE','PLATFORM','CREDIT'),
  ('SYNTH-ACCOUNT-PLATFORM-SUBSIDY','EXPENSE','PLATFORM','DEBIT'),
  ('SYNTH-ACCOUNT-VENDOR-PAYABLE','LIABILITY','PLATFORM','CREDIT'),
  ('SYNTH-ACCOUNT-PARTNER-PAYABLE','LIABILITY','PLATFORM','CREDIT'),
  ('SYNTH-ACCOUNT-FAKE-PROVIDER','CLEARING','PROVIDER','CREDIT'),
  ('SYNTH-ACCOUNT-TAX-PAYABLE','LIABILITY','TAX_AUTHORITY','CREDIT');

ALTER TABLE marketplace.ledger_entries
  ADD CONSTRAINT ledger_entry_account_fk FOREIGN KEY (account_reference)
    REFERENCES marketplace.ledger_accounts (account_reference) ON DELETE RESTRICT;

ALTER TABLE marketplace.ledger_entries DROP CONSTRAINT ledger_entry_component_allowed;
ALTER TABLE marketplace.ledger_entries ADD CONSTRAINT ledger_entry_component_allowed CHECK (component IN
  ('CUSTOMER_CAPTURE','CUSTOMER_REFUND','VENDOR_PROCEEDS','VENDOR_FEE','PAYMENT_FEE','TAX',
   'PARTNER_BASE','PARTNER_DISTANCE','PARTNER_TIME','PARTNER_OUTBOUND','PARTNER_WAIT','PARTNER_RETURN',
   'PARTNER_INCENTIVE','PARTNER_TIP','PLATFORM_REMAINDER','PAYOUT','VOID','REVERSAL','ADJUSTMENT'));

ALTER TABLE marketplace.payment_transactions DROP CONSTRAINT payment_state_allowed;
ALTER TABLE marketplace.payment_transactions ADD CONSTRAINT payment_state_allowed CHECK (payment_state IN
  ('CREATED','AUTHORIZING','AUTHORIZED','CAPTURE_PENDING','CAPTURED','VOID_PENDING','VOIDED',
   'FAILED','CANCELLED','UNKNOWN_REQUIRES_RECONCILIATION'));
ALTER TABLE marketplace.payment_transactions ADD COLUMN voided_at timestamptz;
ALTER TABLE marketplace.payment_transactions
  ADD COLUMN captured_amount_minor bigint NOT NULL DEFAULT 0 CHECK (captured_amount_minor >= 0),
  ADD COLUMN voided_amount_minor bigint NOT NULL DEFAULT 0 CHECK (voided_amount_minor >= 0),
  ADD CONSTRAINT payment_resolved_amounts CHECK
    (captured_amount_minor + voided_amount_minor <= amount_minor);

CREATE TABLE marketplace.settlement_lines (
  settlement_line_id uuid PRIMARY KEY,
  settlement_id uuid NOT NULL REFERENCES marketplace.settlements (settlement_id) ON DELETE RESTRICT,
  participant_kind text NOT NULL,
  component text NOT NULL,
  amount_minor bigint NOT NULL,
  policy_version_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT settlement_line_participant_allowed CHECK
    (participant_kind IN ('CUSTOMER','VENDOR','PARTNER','PLATFORM','TAX_AUTHORITY','PAYMENT_PROVIDER')),
  CONSTRAINT settlement_line_component_allowed CHECK (component IN
    ('CAPTURE','REFUND','ITEM_PROCEEDS','PLATFORM_FEE','PAYMENT_FEE','TAX','DELIVERY_BASE',
     'DELIVERY_DISTANCE','DELIVERY_TIME','WAIT','RETURN','INCENTIVE','TIP','ADJUSTMENT')),
  CONSTRAINT settlement_line_amount_nonzero CHECK (amount_minor <> 0),
  CONSTRAINT settlement_line_policy_shape CHECK
    (policy_version_reference ~ '^SYNTH-POLICY-[A-Z0-9-]{4,64}$')
);
CREATE INDEX settlement_lines_statement ON marketplace.settlement_lines
  (settlement_id,participant_kind,component,settlement_line_id);

CREATE TABLE marketplace.payout_batches (
  payout_batch_id uuid PRIMARY KEY,
  batch_reference text NOT NULL UNIQUE,
  beneficiary_kind text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'DRAFT',
  total_minor bigint NOT NULL DEFAULT 0,
  item_count integer NOT NULL DEFAULT 0,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT payout_batch_reference_shape CHECK
    (batch_reference ~ '^SYNTH-PAYOUT-BATCH-[A-Z0-9-]{4,64}$'),
  CONSTRAINT payout_batch_kind CHECK (beneficiary_kind IN ('VENDOR','PARTNER')),
  CONSTRAINT payout_batch_state CHECK (lifecycle_state IN
    ('DRAFT','READY','SUBMITTED','PARTIALLY_PAID','PAID','FAILED_REVIEW')),
  CONSTRAINT payout_batch_amounts CHECK (total_minor >= 0 AND item_count >= 0)
);
ALTER TABLE marketplace.payouts ADD COLUMN payout_batch_id uuid
  REFERENCES marketplace.payout_batches (payout_batch_id) ON DELETE RESTRICT;
ALTER TABLE marketplace.payouts ADD CONSTRAINT payout_settlement_beneficiary_unique
  UNIQUE (settlement_id,beneficiary_kind);

CREATE TABLE marketplace.provider_statement_imports (
  provider_statement_import_id uuid PRIMARY KEY,
  statement_reference text NOT NULL UNIQUE,
  content_digest text NOT NULL UNIQUE,
  row_count integer NOT NULL CHECK (row_count >= 0),
  imported_by_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT provider_statement_import_reference_shape CHECK
    (statement_reference ~ '^SYNTH-STMT-[A-Z0-9-]{4,64}$'),
  CONSTRAINT provider_statement_import_digest_shape CHECK (content_digest ~ '^[a-f0-9]{64}$')
);

ALTER TABLE marketplace.provider_statement_rows
  ADD COLUMN provider_statement_import_id uuid REFERENCES marketplace.provider_statement_imports
    (provider_statement_import_id) ON DELETE RESTRICT,
  ADD COLUMN reconciliation_class text,
  ADD COLUMN expected_amount_minor bigint,
  ADD COLUMN expected_state text;
ALTER TABLE marketplace.provider_statement_rows
  DROP CONSTRAINT provider_statement_rows_provider_operation_reference_key;
CREATE INDEX provider_statement_rows_operation
  ON marketplace.provider_statement_rows (provider_operation_reference,created_at,statement_row_id);
ALTER TABLE marketplace.provider_statement_rows ADD CONSTRAINT statement_reconciliation_class CHECK
  (reconciliation_class IS NULL OR reconciliation_class IN
    ('MATCHED','UNMATCHED','DUPLICATE','AMOUNT_MISMATCH','STATUS_MISMATCH','MISSING_EXPECTED'));

ALTER TABLE marketplace.finance_exceptions DROP CONSTRAINT finance_exception_kind_allowed;
ALTER TABLE marketplace.finance_exceptions ADD CONSTRAINT finance_exception_kind_allowed CHECK (exception_kind IN
  ('PAYMENT_UNKNOWN','REFUND_UNKNOWN','PAYOUT_UNKNOWN','STATEMENT_MISSING','STATEMENT_CONFLICT',
   'STATEMENT_UNMATCHED','STATEMENT_DUPLICATE','AMOUNT_MISMATCH','STATUS_MISMATCH',
   'LEDGER_UNBALANCED','PAYOUT_DUPLICATE_RISK','CORRECTION_REVIEW'));

CREATE TABLE marketplace.financial_corrections (
  financial_correction_id uuid PRIMARY KEY,
  correction_reference text NOT NULL UNIQUE,
  original_ledger_transaction_id uuid NOT NULL REFERENCES marketplace.ledger_transactions
    (ledger_transaction_id) ON DELETE RESTRICT,
  lifecycle_state text NOT NULL DEFAULT 'PROPOSED',
  reason_code text NOT NULL,
  evidence_reference text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  proposed_entries jsonb NOT NULL CHECK (jsonb_typeof(proposed_entries)='array'),
  proposed_by_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  approved_by_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  reversal_ledger_transaction_id uuid REFERENCES marketplace.ledger_transactions
    (ledger_transaction_id) ON DELETE RESTRICT,
  adjustment_ledger_transaction_id uuid REFERENCES marketplace.ledger_transactions
    (ledger_transaction_id) ON DELETE RESTRICT,
  approval_expires_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT financial_correction_reference_shape CHECK
    (correction_reference ~ '^SYNTH-CORRECTION-[A-Z0-9-]{4,64}$'),
  CONSTRAINT financial_correction_state CHECK
    (lifecycle_state IN ('PROPOSED','APPROVED','POSTED','REJECTED','EXPIRED')),
  CONSTRAINT financial_correction_reason_shape CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT financial_correction_evidence_shape CHECK
    (evidence_reference ~ '^SYNTH-EVIDENCE-[A-Z0-9-]{4,64}$'),
  CONSTRAINT financial_correction_maker_checker CHECK
    (approved_by_user_id IS NULL OR approved_by_user_id <> proposed_by_user_id),
  CONSTRAINT financial_correction_posted_shape CHECK
    ((lifecycle_state='POSTED') = (approved_by_user_id IS NOT NULL
      AND reversal_ledger_transaction_id IS NOT NULL AND adjustment_ledger_transaction_id IS NOT NULL))
);

CREATE TABLE marketplace.financial_correction_events (
  financial_correction_event_id uuid PRIMARY KEY,
  financial_correction_id uuid NOT NULL REFERENCES marketplace.financial_corrections
    (financial_correction_id) ON DELETE RESTRICT,
  correction_version integer NOT NULL,
  event_type text NOT NULL,
  previous_state text,
  resulting_state text NOT NULL,
  actor_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (financial_correction_id,correction_version)
);

CREATE TRIGGER settlement_lines_append_only BEFORE UPDATE OR DELETE ON marketplace.settlement_lines
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_assignment_history();
CREATE TRIGGER provider_statement_imports_append_only BEFORE UPDATE OR DELETE ON marketplace.provider_statement_imports
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_assignment_history();
CREATE TRIGGER provider_statement_rows_append_only BEFORE UPDATE OR DELETE ON marketplace.provider_statement_rows
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_assignment_history();
CREATE TRIGGER financial_correction_events_append_only BEFORE UPDATE OR DELETE ON marketplace.financial_correction_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_assignment_history();

ALTER TABLE marketplace.partner_earnings_records ADD COLUMN ledger_transaction_id uuid
  REFERENCES marketplace.ledger_transactions (ledger_transaction_id) ON DELETE RESTRICT;
