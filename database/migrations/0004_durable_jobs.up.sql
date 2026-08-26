CREATE TABLE marketplace.scheduled_jobs (
  job_id uuid PRIMARY KEY,
  queue_scope text NOT NULL,
  job_type text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  status text NOT NULL DEFAULT 'SCHEDULED',
  priority smallint NOT NULL DEFAULT 50,
  run_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  claimed_by uuid,
  claim_until timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT scheduled_job_scope_format
    CHECK (queue_scope ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' AND length(queue_scope) <= 120),
  CONSTRAINT scheduled_job_type_format
    CHECK (job_type ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' AND length(job_type) <= 120),
  CONSTRAINT scheduled_job_idempotency_key_format
    CHECK (idempotency_key ~ '^[A-Za-z0-9._~:-]{8,200}$'),
  CONSTRAINT scheduled_job_payload_object
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT scheduled_job_status_allowed
    CHECK (status IN ('SCHEDULED', 'RUNNING', 'SUCCEEDED', 'DEAD_LETTER', 'CANCELLED')),
  CONSTRAINT scheduled_job_priority_bounds
    CHECK (priority BETWEEN 0 AND 100),
  CONSTRAINT scheduled_job_attempt_bounds
    CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 100 AND attempt_count <= max_attempts),
  CONSTRAINT scheduled_job_error_code_format
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT scheduled_job_status_shape
    CHECK (
      (status = 'SCHEDULED' AND claimed_by IS NULL AND claim_until IS NULL AND completed_at IS NULL)
      OR
      (status = 'RUNNING' AND claimed_by IS NOT NULL AND claim_until IS NOT NULL AND completed_at IS NULL)
      OR
      (status IN ('SUCCEEDED', 'CANCELLED') AND claimed_by IS NULL AND claim_until IS NULL AND completed_at IS NOT NULL)
      OR
      (status = 'DEAD_LETTER' AND claimed_by IS NULL AND claim_until IS NULL AND completed_at IS NULL)
    ),
  UNIQUE (queue_scope, idempotency_key)
);

CREATE INDEX scheduled_jobs_claim
  ON marketplace.scheduled_jobs (queue_scope, status, run_at, priority DESC, created_at, job_id)
  WHERE status IN ('SCHEDULED', 'RUNNING');

CREATE INDEX scheduled_jobs_dead_letter
  ON marketplace.scheduled_jobs (queue_scope, updated_at, job_id)
  WHERE status = 'DEAD_LETTER';

CREATE TABLE marketplace.job_attempts (
  attempt_id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  worker_id uuid NOT NULL,
  outcome text NOT NULL,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  next_attempt_at timestamptz,
  CONSTRAINT job_attempt_job_fk
    FOREIGN KEY (job_id)
    REFERENCES marketplace.scheduled_jobs (job_id)
    ON DELETE RESTRICT,
  CONSTRAINT job_attempt_number_positive
    CHECK (attempt_number >= 1),
  CONSTRAINT job_attempt_outcome_allowed
    CHECK (outcome IN ('RUNNING', 'SUCCEEDED', 'RETRY_SCHEDULED', 'DEAD_LETTER', 'LEASE_EXPIRED')),
  CONSTRAINT job_attempt_error_code_format
    CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT job_attempt_outcome_shape
    CHECK (
      (outcome = 'RUNNING' AND finished_at IS NULL AND next_attempt_at IS NULL AND error_code IS NULL)
      OR
      (outcome = 'SUCCEEDED' AND finished_at IS NOT NULL AND next_attempt_at IS NULL AND error_code IS NULL)
      OR
      (outcome = 'RETRY_SCHEDULED' AND finished_at IS NOT NULL AND next_attempt_at IS NOT NULL AND error_code IS NOT NULL)
      OR
      (outcome IN ('DEAD_LETTER', 'LEASE_EXPIRED') AND finished_at IS NOT NULL AND error_code IS NOT NULL)
    ),
  UNIQUE (job_id, attempt_number)
);

CREATE INDEX job_attempts_job_history
  ON marketplace.job_attempts (job_id, attempt_number);

CREATE INDEX job_attempts_recent_failures
  ON marketplace.job_attempts (finished_at, outcome)
  WHERE outcome IN ('RETRY_SCHEDULED', 'DEAD_LETTER', 'LEASE_EXPIRED');

CREATE TABLE marketplace.job_recoveries (
  recovery_id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  reason_code text NOT NULL,
  previous_attempt_count integer NOT NULL,
  attempts_added integer NOT NULL,
  recovered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT job_recovery_job_fk
    FOREIGN KEY (job_id)
    REFERENCES marketplace.scheduled_jobs (job_id)
    ON DELETE RESTRICT,
  CONSTRAINT job_recovery_reason_format
    CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT job_recovery_attempt_bounds
    CHECK (previous_attempt_count >= 1 AND attempts_added BETWEEN 1 AND 25)
);

CREATE INDEX job_recoveries_job
  ON marketplace.job_recoveries (job_id, recovered_at);

CREATE FUNCTION marketplace.protect_scheduled_job_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.queue_scope IS DISTINCT FROM OLD.queue_scope
     OR NEW.job_type IS DISTINCT FROM OLD.job_type
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.causation_id IS DISTINCT FROM OLD.causation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'scheduled job content is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER scheduled_job_content_immutable
BEFORE UPDATE ON marketplace.scheduled_jobs
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_scheduled_job_content();

CREATE FUNCTION marketplace.protect_job_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'job_attempts'
     AND TG_OP = 'UPDATE'
     AND OLD.outcome = 'RUNNING'
     AND NEW.outcome IN ('SUCCEEDED', 'RETRY_SCHEDULED', 'DEAD_LETTER', 'LEASE_EXPIRED')
     AND NEW.attempt_id = OLD.attempt_id
     AND NEW.job_id = OLD.job_id
     AND NEW.attempt_number = OLD.attempt_number
     AND NEW.worker_id = OLD.worker_id
     AND NEW.started_at = OLD.started_at
     AND NEW.finished_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'job history is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER scheduled_jobs_no_delete
BEFORE DELETE ON marketplace.scheduled_jobs
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_job_history();

CREATE TRIGGER job_attempts_controlled_update
BEFORE UPDATE OR DELETE ON marketplace.job_attempts
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_job_history();

CREATE TRIGGER job_recoveries_append_only
BEFORE UPDATE OR DELETE ON marketplace.job_recoveries
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_job_history();

COMMENT ON TABLE marketplace.scheduled_jobs IS
  'Durable scheduled work with bounded ownership, retries and terminal state.';

COMMENT ON TABLE marketplace.job_attempts IS
  'Append-only execution attempt history including retry and lease-expiry outcomes.';

COMMENT ON TABLE marketplace.job_recoveries IS
  'Append-only attributable recovery history for dead-lettered jobs.';
