DROP INDEX IF EXISTS marketplace.assignment_events_partner_by_attempt;
ALTER TABLE marketplace.assignment_events DROP COLUMN partner_user_id;
