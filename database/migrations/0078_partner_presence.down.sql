DROP INDEX IF EXISTS marketplace.partner_availability_presence;
ALTER TABLE marketplace.partner_availability DROP COLUMN last_seen_at;
