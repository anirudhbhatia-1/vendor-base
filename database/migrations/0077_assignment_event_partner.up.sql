-- The partner an assignment event concerns, recorded on the event.
--
-- An offer names its partner only on the live assignment row, and returning
-- the attempt to the pool clears that column. So once an offer had expired
-- there was no record of who had let it lapse: `OFFERED` is written by the
-- worker and `OFFER_EXPIRED` by the system, and neither event carried the
-- rider. Dispatch could therefore exclude partners who *declined* (they act,
-- so they are the actor on the event) but not partners who simply ignored the
-- offer -- and it re-offered every expired attempt to the nearest online
-- partner, which is the same one. A second partner who came online and stood
-- ready never saw the job. Workflow 6.7.3 says expired offers return to the
-- pool; a pool of one is not a pool.
--
-- Nullable, because creation and pool-return events name nobody. History is
-- append-only (0014), so nothing is backfilled: the live offer's expiry will be
-- the first event recorded with its partner, which is enough for rotation.
ALTER TABLE marketplace.assignment_events
  ADD COLUMN partner_user_id uuid
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT;

CREATE INDEX assignment_events_partner_by_attempt
  ON marketplace.assignment_events (delivery_assignment_id, event_type, partner_user_id)
  WHERE partner_user_id IS NOT NULL;

COMMENT ON COLUMN marketplace.assignment_events.partner_user_id IS
  'The partner this event concerns: the offeree on OFFERED and OFFER_EXPIRED, the holder on every later transition. Null when the attempt names nobody. Not the actor, which may be the worker or an operator.';
