-- The platform itself, as a user row.
--
-- The worker's sweeps and outbox consumers act on nobody's behalf, and the
-- histories they write -- vendor order events, admin audit, partner
-- earnings -- require their actor to be a user. The worker used a fresh
-- random id per process, so the accept-deadline sweep failed on
-- vendor_order_events_actor_id_fkey and rolled back on every tick: an order
-- the shop never answered was never expired and its holds never released.
-- This row is the actor every sweep runs as. It never signs in: no phone,
-- no email, no session, no role.
INSERT INTO marketplace.users (user_id, state, data_classification)
VALUES ('01900000-0000-7000-8000-00000000c0de', 'ACTIVE', 'RESTRICTED')
ON CONFLICT (user_id) DO NOTHING;
