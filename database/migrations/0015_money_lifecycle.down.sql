DROP TRIGGER IF EXISTS ledger_entries_append_only ON marketplace.ledger_entries;
DROP TRIGGER IF EXISTS ledger_transactions_append_only ON marketplace.ledger_transactions;
DROP TRIGGER IF EXISTS refund_events_append_only ON marketplace.refund_events;
DROP TRIGGER IF EXISTS payment_events_append_only ON marketplace.payment_events;
DROP TRIGGER IF EXISTS ledger_transaction_balanced ON marketplace.ledger_entries;
DROP FUNCTION IF EXISTS marketplace.ensure_ledger_transaction_balanced();
DROP TABLE IF EXISTS marketplace.finance_exceptions;
DROP TABLE IF EXISTS marketplace.provider_statement_rows;
DROP TABLE IF EXISTS marketplace.payouts;
DROP TABLE IF EXISTS marketplace.settlements;
DROP TABLE IF EXISTS marketplace.ledger_entries;
DROP TABLE IF EXISTS marketplace.ledger_transactions;
DROP TABLE IF EXISTS marketplace.refund_events;
DROP TABLE IF EXISTS marketplace.refunds;
DROP TABLE IF EXISTS marketplace.payment_events;
DROP TABLE IF EXISTS marketplace.payment_allocations;
DROP TABLE IF EXISTS marketplace.payment_transactions;
DELETE FROM marketplace.role_capabilities
 WHERE capability_key IN ('vendor.finance.read','partner.finance.read','admin.finance.ledger_manage');
DELETE FROM marketplace.capabilities
 WHERE capability_key IN ('vendor.finance.read','partner.finance.read','admin.finance.ledger_manage');
