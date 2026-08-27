DROP TRIGGER IF EXISTS financial_correction_events_append_only ON marketplace.financial_correction_events;
ALTER TABLE marketplace.partner_earnings_records DROP COLUMN IF EXISTS ledger_transaction_id;
DROP TRIGGER IF EXISTS provider_statement_rows_append_only ON marketplace.provider_statement_rows;
DROP TRIGGER IF EXISTS provider_statement_imports_append_only ON marketplace.provider_statement_imports;
DROP TRIGGER IF EXISTS settlement_lines_append_only ON marketplace.settlement_lines;
DROP TABLE IF EXISTS marketplace.financial_correction_events;
DROP TABLE IF EXISTS marketplace.financial_corrections;
ALTER TABLE marketplace.finance_exceptions DROP CONSTRAINT IF EXISTS finance_exception_kind_allowed;
ALTER TABLE marketplace.finance_exceptions ADD CONSTRAINT finance_exception_kind_allowed CHECK (exception_kind IN
  ('PAYMENT_UNKNOWN','REFUND_UNKNOWN','PAYOUT_UNKNOWN','STATEMENT_MISSING','STATEMENT_CONFLICT','LEDGER_UNBALANCED'));
ALTER TABLE marketplace.provider_statement_rows
  DROP CONSTRAINT IF EXISTS statement_reconciliation_class,
  DROP COLUMN IF EXISTS expected_state,
  DROP COLUMN IF EXISTS expected_amount_minor,
  DROP COLUMN IF EXISTS reconciliation_class,
  DROP COLUMN IF EXISTS provider_statement_import_id;
DROP INDEX IF EXISTS marketplace.provider_statement_rows_operation;
ALTER TABLE marketplace.provider_statement_rows
  ADD CONSTRAINT provider_statement_rows_provider_operation_reference_key
    UNIQUE (provider_operation_reference);
DROP TABLE IF EXISTS marketplace.provider_statement_imports;
ALTER TABLE marketplace.payouts DROP CONSTRAINT IF EXISTS payout_settlement_beneficiary_unique;
ALTER TABLE marketplace.payouts DROP COLUMN IF EXISTS payout_batch_id;
DROP TABLE IF EXISTS marketplace.payout_batches;
DROP TABLE IF EXISTS marketplace.settlement_lines;
ALTER TABLE marketplace.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_resolved_amounts,
  DROP COLUMN IF EXISTS voided_amount_minor,
  DROP COLUMN IF EXISTS captured_amount_minor,
  DROP COLUMN IF EXISTS voided_at;
ALTER TABLE marketplace.payment_transactions DROP CONSTRAINT IF EXISTS payment_state_allowed;
ALTER TABLE marketplace.payment_transactions ADD CONSTRAINT payment_state_allowed CHECK (payment_state IN
  ('CREATED','AUTHORIZING','AUTHORIZED','CAPTURE_PENDING','CAPTURED','FAILED','CANCELLED','UNKNOWN_REQUIRES_RECONCILIATION'));
ALTER TABLE marketplace.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entry_component_allowed;
ALTER TABLE marketplace.ledger_entries ADD CONSTRAINT ledger_entry_component_allowed CHECK (component IN
  ('CUSTOMER_CAPTURE','CUSTOMER_REFUND','VENDOR_PROCEEDS','VENDOR_FEE','PARTNER_OUTBOUND',
   'PARTNER_WAIT','PARTNER_RETURN','PARTNER_TIP','PLATFORM_REMAINDER','PAYOUT','ADJUSTMENT'));
ALTER TABLE marketplace.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entry_account_fk;
DROP TABLE IF EXISTS marketplace.ledger_accounts;
