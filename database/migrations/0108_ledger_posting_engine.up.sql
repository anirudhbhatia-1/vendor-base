-- 10.1: the ledger's account catalogue governs what may be posted, every
-- posting names what it records, and a transaction is never an empty shell.
--
-- Until audit run 66 the catalogue (0028) was consulted by nothing: a CLOSED
-- account accepted entries, a vendor's proceeds and a partner's payout were
-- posted to the shared payable accounts naming no vendor and no partner, the
-- transaction carried no provider or policy reference, and a transaction row
-- with no entries passed the balance check because that check lives on the
-- entries. The catalogue itself could be rewritten by a plain UPDATE.

-- Which entry column must name the owner of an amount on this account. The
-- payables are platform liabilities owed per vendor and per partner; an entry
-- on them that names nobody is money owed to no one.
ALTER TABLE marketplace.ledger_accounts
  ADD COLUMN owner_dimension text NOT NULL DEFAULT 'NONE',
  ADD CONSTRAINT ledger_account_owner_dimension_allowed CHECK
    (owner_dimension IN ('NONE','VENDOR_LOCATION','PARTNER_USER'));

UPDATE marketplace.ledger_accounts SET owner_dimension='VENDOR_LOCATION'
 WHERE account_reference='SYNTH-ACCOUNT-VENDOR-PAYABLE';
UPDATE marketplace.ledger_accounts SET owner_dimension='PARTNER_USER'
 WHERE account_reference='SYNTH-ACCOUNT-PARTNER-PAYABLE';

-- The provider operation and the policy version a posting was made under,
-- beside the business reference and the request/correlation it already had.
ALTER TABLE marketplace.ledger_transactions
  ADD COLUMN provider_operation_reference text,
  ADD COLUMN policy_version_reference text,
  ADD CONSTRAINT ledger_provider_shape CHECK
    (provider_operation_reference IS NULL
     OR provider_operation_reference ~ '^SYNTH-(PAY|REF|PAYOUT)-[A-Z0-9-]{4,64}$'),
  ADD CONSTRAINT ledger_policy_shape CHECK
    (policy_version_reference IS NULL
     OR policy_version_reference ~ '^SYNTH-POLICY-[A-Z0-9-]{4,64}$');

CREATE INDEX ledger_transactions_provider ON marketplace.ledger_transactions
  (provider_operation_reference) WHERE provider_operation_reference IS NOT NULL;
CREATE INDEX ledger_entries_vendor ON marketplace.ledger_entries
  (vendor_location_id, created_at) WHERE vendor_location_id IS NOT NULL;
CREATE INDEX ledger_entries_partner ON marketplace.ledger_entries
  (partner_user_id, created_at) WHERE partner_user_id IS NOT NULL;

-- An entry is postable only to an ACTIVE account, and on an account with an
-- owner dimension it must name the owner. A REVERSAL mirrors history as it
-- was posted, owner or not, so it is exempt from the second rule only.
CREATE FUNCTION marketplace.ensure_ledger_entry_postable()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account marketplace.ledger_accounts%ROWTYPE;
DECLARE kind text;
BEGIN
  SELECT * INTO account FROM marketplace.ledger_accounts
   WHERE account_reference = NEW.account_reference;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ledger account % is not in the catalogue', NEW.account_reference
      USING ERRCODE = '23503';
  END IF;
  IF account.lifecycle_state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'ledger account % is closed', NEW.account_reference USING ERRCODE = '23514';
  END IF;
  SELECT transaction_kind INTO kind FROM marketplace.ledger_transactions
   WHERE ledger_transaction_id = NEW.ledger_transaction_id;
  IF kind IS DISTINCT FROM 'REVERSAL' THEN
    IF account.owner_dimension = 'VENDOR_LOCATION' AND NEW.vendor_location_id IS NULL THEN
      RAISE EXCEPTION 'ledger entry on % names no vendor', NEW.account_reference
        USING ERRCODE = '23514';
    END IF;
    IF account.owner_dimension = 'PARTNER_USER' AND NEW.partner_user_id IS NULL THEN
      RAISE EXCEPTION 'ledger entry on % names no partner', NEW.account_reference
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entry_postable BEFORE INSERT ON marketplace.ledger_entries
FOR EACH ROW EXECUTE FUNCTION marketplace.ensure_ledger_entry_postable();

-- A transaction is at least two entries. The balance trigger on the entries
-- never fires for a transaction that has none, so this is checked from the
-- transaction's side at commit.
CREATE FUNCTION marketplace.ensure_ledger_transaction_has_entries()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entries integer;
BEGIN
  SELECT count(*) INTO entries FROM marketplace.ledger_entries
   WHERE ledger_transaction_id = NEW.ledger_transaction_id;
  IF entries < 2 THEN
    RAISE EXCEPTION 'ledger transaction % has % entries', NEW.source_reference, entries
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_transaction_has_entries
AFTER INSERT ON marketplace.ledger_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION marketplace.ensure_ledger_transaction_has_entries();

-- The catalogue is durable configuration: an account may be closed or
-- reopened, and nothing else about it may change once it exists.
CREATE FUNCTION marketplace.protect_ledger_account()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger accounts are never deleted' USING ERRCODE = '55000';
  END IF;
  IF NEW.account_reference <> OLD.account_reference
     OR NEW.account_type <> OLD.account_type
     OR NEW.owner_kind <> OLD.owner_kind
     OR NEW.normal_side <> OLD.normal_side
     OR NEW.currency <> OLD.currency
     OR NEW.owner_dimension <> OLD.owner_dimension
     OR NEW.vendor_location_id IS DISTINCT FROM OLD.vendor_location_id
     OR NEW.partner_user_id IS DISTINCT FROM OLD.partner_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'only a ledger account''s lifecycle state may change' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_accounts_protected BEFORE UPDATE OR DELETE ON marketplace.ledger_accounts
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_ledger_account();

COMMENT ON COLUMN marketplace.ledger_accounts.owner_dimension IS
  'Which entry column must name the owner of an amount on this account: NONE, VENDOR_LOCATION or PARTNER_USER.';
COMMENT ON COLUMN marketplace.ledger_transactions.provider_operation_reference IS
  'The synthetic provider operation this posting records, when there is one.';
COMMENT ON COLUMN marketplace.ledger_transactions.policy_version_reference IS
  'The financial policy version the amounts were divided under, when a policy applied.';
