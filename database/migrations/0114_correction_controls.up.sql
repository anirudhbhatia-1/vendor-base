-- 10.6: a correction says what it will do before it is posted, is approved
-- by a second person above the policy's limit, is posted at most once per
-- original, and its proposal is history that cannot be rewritten.
--
-- Until audit run 70 a correction recorded no impact, so its approver saw a
-- list of entries and not what they would move; every correction needed two
-- people whatever its size, with no policy saying where that line is; two
-- corrections of one posting would each reverse it; a proposal nobody acted
-- on stayed PROPOSED past its window and could not be rejected; and the
-- proposed entries, amount and reason could be rewritten by an UPDATE.

-- What the proposal would move, as the approver is shown it, and the limit it
-- was measured against when it was proposed.
ALTER TABLE marketplace.financial_corrections
  ADD COLUMN impact jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN impact_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN single_approval_limit_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN second_approval_required boolean NOT NULL DEFAULT true,
  ADD COLUMN closed_by_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  ADD COLUMN closing_reason_code text,
  ADD CONSTRAINT financial_correction_impact_shape CHECK (
    jsonb_typeof(impact) = 'array' AND impact_minor >= 0 AND single_approval_limit_minor >= 0),
  ADD CONSTRAINT financial_correction_closing_reason_shape CHECK (
    closing_reason_code IS NULL OR closing_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$');

-- A second person is required exactly when the impact is over the limit;
-- NOT VALID leaves corrections proposed before the limit existed as they were.
ALTER TABLE marketplace.financial_corrections
  ADD CONSTRAINT financial_correction_threshold_shape CHECK (
    second_approval_required = (impact_minor > single_approval_limit_minor)) NOT VALID,
  ADD CONSTRAINT financial_correction_closed_shape CHECK (
    (lifecycle_state IN ('REJECTED','EXPIRED')) = (closing_reason_code IS NOT NULL)
    AND (lifecycle_state = 'REJECTED') = (closed_by_user_id IS NOT NULL)) NOT VALID;
ALTER TABLE marketplace.financial_corrections DROP CONSTRAINT financial_correction_maker_checker;
ALTER TABLE marketplace.financial_corrections ADD CONSTRAINT financial_correction_maker_checker CHECK (
  approved_by_user_id IS NULL OR approved_by_user_id <> proposed_by_user_id
  OR NOT second_approval_required);

-- A posting is corrected once: a second correction of the same fact
-- corrects the first correction's adjustment.
CREATE UNIQUE INDEX financial_corrections_one_live_per_original
  ON marketplace.financial_corrections (original_ledger_transaction_id)
  WHERE lifecycle_state IN ('PROPOSED','APPROVED','POSTED');
CREATE INDEX financial_corrections_open
  ON marketplace.financial_corrections (approval_expires_at)
  WHERE lifecycle_state = 'PROPOSED';

-- What was proposed never changes; a proposal moves once, out of PROPOSED.
CREATE FUNCTION marketplace.protect_financial_corrections() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR OLD.lifecycle_state <> 'PROPOSED'
     OR NEW.financial_correction_id <> OLD.financial_correction_id
     OR NEW.correction_reference <> OLD.correction_reference
     OR NEW.original_ledger_transaction_id <> OLD.original_ledger_transaction_id
     OR NEW.reason_code <> OLD.reason_code
     OR NEW.evidence_reference <> OLD.evidence_reference
     OR NEW.amount_minor <> OLD.amount_minor
     OR NEW.proposed_entries <> OLD.proposed_entries
     OR NEW.proposed_by_user_id <> OLD.proposed_by_user_id
     OR NEW.impact <> OLD.impact
     OR NEW.impact_minor <> OLD.impact_minor
     OR NEW.single_approval_limit_minor <> OLD.single_approval_limit_minor
     OR NEW.second_approval_required <> OLD.second_approval_required
     OR NEW.approval_expires_at <> OLD.approval_expires_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'financial corrections are history once proposed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER financial_corrections_history
BEFORE UPDATE OR DELETE ON marketplace.financial_corrections
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_financial_corrections();
