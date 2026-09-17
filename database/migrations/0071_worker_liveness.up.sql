-- Durable worker liveness.
--
-- The worker's heartbeat was a `setInterval` writing `worker.heartbeat` to its own
-- stdout every 30 seconds. Nothing outside that process could observe it, so the
-- API had no way to answer "is anything consuming these queues" and
-- `/health/ready` reported `queue: 'ready'` from `to_regclass()` -- the presence of
-- two PostgreSQL tables -- while Valkey could be down and no consumer running.
--
-- A log line is not evidence a consumer exists. This gives the heartbeat somewhere
-- durable to land, so readiness can distinguish "the job schema is installed" from
-- "a worker is actually claiming jobs".
--
-- Deliberately not append-only and deliberately without `retention_class`: this is
-- operational liveness, not user data or financial history. Rows are upserted in
-- place by worker id, and `marketplace.unclassified_retention_rows()` sweeps only
-- tables that declare the column, so this one is correctly out of its scope.
CREATE TABLE marketplace.worker_heartbeats (
  worker_id uuid PRIMARY KEY,
  component text NOT NULL,
  queues text[] NOT NULL,
  environment text NOT NULL,
  version text NOT NULL,
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  -- Set on graceful shutdown so a worker that stopped on purpose is
  -- distinguishable from one that vanished mid-job.
  stopped_at timestamptz,
  CONSTRAINT worker_heartbeat_component_shape CHECK (component ~ '^[a-z][a-z0-9._-]{2,63}$'),
  CONSTRAINT worker_heartbeat_queues_present CHECK (cardinality(queues) > 0),
  CONSTRAINT worker_heartbeat_seen_after_start CHECK (last_seen_at >= started_at),
  CONSTRAINT worker_heartbeat_stop_after_start CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);

CREATE INDEX worker_heartbeats_live
  ON marketplace.worker_heartbeats (last_seen_at DESC)
  WHERE stopped_at IS NULL;
