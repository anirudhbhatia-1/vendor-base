DROP TRIGGER ledger_accounts_protected ON marketplace.ledger_accounts;
DROP FUNCTION marketplace.protect_ledger_account();
DROP TRIGGER ledger_transaction_has_entries ON marketplace.ledger_transactions;
DROP FUNCTION marketplace.ensure_ledger_transaction_has_entries();
DROP TRIGGER ledger_entry_postable ON marketplace.ledger_entries;
DROP FUNCTION marketplace.ensure_ledger_entry_postable();
DROP INDEX marketplace.ledger_entries_partner;
DROP INDEX marketplace.ledger_entries_vendor;
DROP INDEX marketplace.ledger_transactions_provider;
ALTER TABLE marketplace.ledger_transactions
  DROP CONSTRAINT ledger_policy_shape,
  DROP CONSTRAINT ledger_provider_shape,
  DROP COLUMN policy_version_reference,
  DROP COLUMN provider_operation_reference;
ALTER TABLE marketplace.ledger_accounts
  DROP CONSTRAINT ledger_account_owner_dimension_allowed,
  DROP COLUMN owner_dimension;
