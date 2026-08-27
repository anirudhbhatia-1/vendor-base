-- The account catalogue is durable configuration. Optional owner identifiers
-- are retained for scoped reporting, but are not lifecycle foreign keys: a
-- disposable vendor/user fixture rebuild must never truncate the chart of
-- accounts through TRUNCATE ... CASCADE.
ALTER TABLE marketplace.ledger_accounts
  DROP CONSTRAINT ledger_accounts_vendor_location_id_fkey,
  DROP CONSTRAINT ledger_accounts_partner_user_id_fkey;
