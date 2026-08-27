-- Phase 11 completion: single-use export redemption and indexed operational deadlines.
ALTER TABLE marketplace.report_exports
  ADD COLUMN downloaded_at timestamptz,
  ADD COLUMN downloaded_by_user_id uuid REFERENCES marketplace.users(user_id) ON DELETE RESTRICT;
CREATE INDEX report_exports_expiry ON marketplace.report_exports (expires_at) WHERE downloaded_at IS NULL;
CREATE INDEX support_cases_sla_queue ON marketplace.support_cases (severity, response_due_at, created_at)
  WHERE lifecycle_state IN ('OPEN','IN_PROGRESS');
CREATE INDEX trust_restriction_review_queue ON marketplace.trust_restriction_cases (review_at)
  WHERE lifecycle_state IN ('PROPOSED','ACTIVE');
CREATE INDEX incident_control_review_queue ON marketplace.incident_controls (review_at)
  WHERE lifecycle_state = 'ACTIVE';
