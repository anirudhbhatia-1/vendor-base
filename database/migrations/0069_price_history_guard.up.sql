-- `catalogue_prices` is the temporal record of what a variant cost and when. Step 5.5
-- requires that history be preserved "for later order snapshots": when a charge is
-- disputed, the order carries its own copied amount and this table is the independent
-- corroboration of what the price was that day.
--
-- Eight other history tables carry an append-only guard -- aggregate transitions, the
-- outbox and inbox, scheduled jobs and attempts, configuration versions, snapshots and
-- lifecycle events. This one had none, so a historical price could be rewritten or
-- deleted and the corroborating record changed to match whatever was claimed.
--
-- A flat append-only rule would break price changes, because closing the open row is
-- how a new price is opened. Exactly one update is legitimate: setting `effective_until`
-- on a row where it was null, changing nothing else. That is what this permits.

CREATE OR REPLACE FUNCTION marketplace.protect_price_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.effective_until IS NULL
       AND NEW.effective_until IS NOT NULL
       AND NEW.catalogue_price_id = OLD.catalogue_price_id
       AND NEW.catalogue_variant_id = OLD.catalogue_variant_id
       AND NEW.price_minor = OLD.price_minor
       AND NEW.currency = OLD.currency
       AND NEW.effective_from = OLD.effective_from
       AND NEW.reason_code = OLD.reason_code
       AND NEW.created_at = OLD.created_at THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'price history is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER catalogue_prices_controlled_update
BEFORE UPDATE OR DELETE ON marketplace.catalogue_prices
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_price_history();
