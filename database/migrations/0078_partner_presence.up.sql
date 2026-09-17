-- Presence has to be recent to count.
--
-- A partner who went online and never went offline stayed ONLINE forever, at
-- the location they had then. On the reporting environment ten such partners
-- from an acceptance run two weeks earlier sat 30 metres from a store, all
-- online, all eligible, all free -- and a real partner 3.3 km away who had
-- come online that morning was ranked behind every one of them. The job
-- rotated through the ghosts five minutes at a time.
--
-- `last_seen_at` is when the partner's device last confirmed it was there:
-- set on going online, refreshed by the heartbeat the app sends while online,
-- and required by dispatch to be within the presence window. Backfilled from
-- `updated_at`, which is the last moment the row was touched -- the honest
-- upper bound on when each partner was actually seen.
ALTER TABLE marketplace.partner_availability
  ADD COLUMN last_seen_at timestamptz;
UPDATE marketplace.partner_availability SET last_seen_at = updated_at;
ALTER TABLE marketplace.partner_availability
  ALTER COLUMN last_seen_at SET NOT NULL,
  ALTER COLUMN last_seen_at SET DEFAULT clock_timestamp();

CREATE INDEX partner_availability_presence
  ON marketplace.partner_availability (last_seen_at)
  WHERE availability_state = 'ONLINE';

COMMENT ON COLUMN marketplace.partner_availability.last_seen_at IS
  'When the partner''s device last confirmed presence: set on going online and refreshed by the heartbeat sent while online. Dispatch considers only partners seen within its presence window; an ONLINE row older than that is a session that ended without saying so.';
