-- The customer's chosen prepaid method was collected by the checkout UI and
-- then discarded: the radio group set React state that `checkout.place` never
-- sent, so every payment recorded the same unspecified method. CUS-40, CUS-41
-- and CUS-42 each require the selected method to be a real, recorded fact.
--
-- Nullable and defaulted so existing rows stay valid without a backfill:
-- historical payments genuinely do not know which method was used, and
-- inventing one would be a worse record than admitting the gap (expand first,
-- contract later, per the expand-and-contract rule).
ALTER TABLE marketplace.payment_transactions
  ADD COLUMN payment_method text;

ALTER TABLE marketplace.payment_transactions
  ADD CONSTRAINT payment_method_allowed
    CHECK (payment_method IS NULL OR payment_method IN ('UPI', 'CARD', 'WALLET'));

-- Cash on delivery is a gated capability (GAT-01) and is deliberately absent
-- from the constraint rather than merely hidden in the UI, so it cannot arrive
-- through a client, a fixture, or a future code path without a schema change
-- that a reviewer has to see.

COMMENT ON COLUMN marketplace.payment_transactions.payment_method IS
  'Prepaid method chosen by the customer at checkout. Null for payments recorded before the method was captured.';
