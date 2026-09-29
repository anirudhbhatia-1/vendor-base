-- Signals, appeals and the case history cannot be represented before this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.trust_signals)
     OR EXISTS (SELECT 1 FROM marketplace.trust_appeals)
     OR EXISTS (SELECT 1 FROM marketplace.trust_case_events)
     OR EXISTS (SELECT 1 FROM marketplace.trust_restriction_cases WHERE evidence_reference IS NULL)
     OR EXISTS (SELECT 1 FROM marketplace.checkout_quote_blocked_groups WHERE reason_code = 'CUSTOMER_RESTRICTED') THEN
    RAISE EXCEPTION 'trust review history exists; 0118 cannot be rolled back' USING ERRCODE = '55000';
  END IF;
END;
$$;

DELETE FROM marketplace.locale_translations WHERE locale_key IN
  ('customer.checkout.blocked.customer_restricted', 'customer.restriction.heading',
   'customer.restriction.appeal');
DELETE FROM marketplace.locale_keys WHERE locale_key IN
  ('customer.checkout.blocked.customer_restricted', 'customer.restriction.heading',
   'customer.restriction.appeal');

ALTER TABLE marketplace.checkout_quote_blocked_groups
  DROP CONSTRAINT checkout_quote_blocked_groups_reason_code_check,
  ADD CONSTRAINT checkout_quote_blocked_groups_reason_code_check CHECK
    (reason_code IN ('STORE_UNAVAILABLE', 'FULFILMENT_METHOD_UNAVAILABLE', 'LINE_UNAVAILABLE',
                     'MINIMUM_NOT_MET', 'INVENTORY_UNAVAILABLE'));
DROP FUNCTION marketplace.trust_restricts(text, text, uuid, text, timestamptz);
DROP TABLE marketplace.trust_appeals;
DROP TABLE marketplace.trust_case_events;
DROP TABLE marketplace.trust_restriction_signals;
DROP INDEX marketplace.trust_restriction_in_force;
ALTER TABLE marketplace.trust_restriction_cases
  DROP CONSTRAINT trust_restriction_review_shape,
  DROP CONSTRAINT trust_restriction_review_outcome,
  DROP CONSTRAINT trust_restriction_decision_reason,
  DROP CONSTRAINT trust_restriction_decision_shape,
  DROP CONSTRAINT trust_restriction_proposal_note,
  DROP CONSTRAINT trust_restriction_evidence_quality,
  DROP COLUMN last_reviewed_at,
  DROP COLUMN last_reviewed_by_user_id,
  DROP COLUMN last_review_outcome,
  DROP COLUMN decided_at,
  DROP COLUMN decision_reason_code,
  DROP COLUMN decided_by_user_id,
  DROP COLUMN proposal_note,
  DROP COLUMN evidence_quality,
  ALTER COLUMN evidence_reference SET NOT NULL;
DROP TABLE marketplace.trust_signal_dismissals;
DROP TABLE marketplace.trust_signals;
