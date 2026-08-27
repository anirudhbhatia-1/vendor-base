DROP INDEX IF EXISTS marketplace.incident_control_review_queue;
DROP INDEX IF EXISTS marketplace.trust_restriction_review_queue;
DROP INDEX IF EXISTS marketplace.support_cases_sla_queue;
DROP INDEX IF EXISTS marketplace.report_exports_expiry;
ALTER TABLE marketplace.report_exports DROP COLUMN downloaded_by_user_id, DROP COLUMN downloaded_at;
