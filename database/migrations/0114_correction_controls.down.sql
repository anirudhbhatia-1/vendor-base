DROP TRIGGER financial_corrections_history ON marketplace.financial_corrections;
DROP FUNCTION marketplace.protect_financial_corrections();
DROP INDEX marketplace.financial_corrections_open;
DROP INDEX marketplace.financial_corrections_one_live_per_original;

-- A correction posted by its own proposer under the limit cannot be
-- represented before this migration; rolling back past one is refused.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.financial_corrections
              WHERE approved_by_user_id = proposed_by_user_id) THEN
    RAISE EXCEPTION 'single-approval corrections exist; 0114 cannot be rolled back'
      USING ERRCODE = '55000';
  END IF;
END;
$$;
ALTER TABLE marketplace.financial_corrections DROP CONSTRAINT financial_correction_maker_checker;
ALTER TABLE marketplace.financial_corrections ADD CONSTRAINT financial_correction_maker_checker
  CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> proposed_by_user_id);
ALTER TABLE marketplace.financial_corrections
  DROP CONSTRAINT financial_correction_closed_shape,
  DROP CONSTRAINT financial_correction_threshold_shape,
  DROP CONSTRAINT financial_correction_closing_reason_shape,
  DROP CONSTRAINT financial_correction_impact_shape,
  DROP COLUMN closing_reason_code,
  DROP COLUMN closed_by_user_id,
  DROP COLUMN second_approval_required,
  DROP COLUMN single_approval_limit_minor,
  DROP COLUMN impact_minor,
  DROP COLUMN impact;
