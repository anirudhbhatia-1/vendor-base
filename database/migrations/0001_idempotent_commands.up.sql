CREATE TABLE marketplace.idempotency_records (
  record_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  command_scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash character(64) NOT NULL,
  request_id uuid NOT NULL,
  status text NOT NULL,
  http_status smallint,
  response_body jsonb,
  lease_expires_at timestamptz NOT NULL,
  reconciliation_due_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT idempotency_command_scope_format
    CHECK (command_scope ~ '^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$' AND length(command_scope) <= 120),
  CONSTRAINT idempotency_key_format
    CHECK (idempotency_key ~ '^[A-Za-z0-9._~:-]{8,200}$'),
  CONSTRAINT idempotency_request_hash_format
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT idempotency_status_allowed
    CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'UNCERTAIN')),
  CONSTRAINT idempotency_http_status_range
    CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  CONSTRAINT idempotency_response_state
    CHECK (
      (status = 'IN_PROGRESS' AND http_status IS NULL AND response_body IS NULL AND reconciliation_due_at IS NULL)
      OR
      (status IN ('SUCCEEDED', 'FAILED') AND http_status IS NOT NULL AND response_body IS NOT NULL AND response_body <> 'null'::jsonb AND reconciliation_due_at IS NULL)
      OR
      (status = 'UNCERTAIN' AND http_status = 202 AND response_body IS NOT NULL AND response_body <> 'null'::jsonb AND reconciliation_due_at IS NOT NULL)
    ),
  CONSTRAINT idempotency_retention_minimum
    CHECK (expires_at >= created_at + interval '24 hours'),
  CONSTRAINT idempotency_uncertain_retention
    CHECK (
      status <> 'UNCERTAIN'
      OR (expires_at >= reconciliation_due_at AND expires_at >= created_at + interval '7 days')
    ),
  CONSTRAINT idempotency_lease_after_creation
    CHECK (lease_expires_at > created_at)
);

CREATE UNIQUE INDEX unique_idempotent_command
  ON marketplace.idempotency_records (actor_id, command_scope, idempotency_key);

CREATE INDEX idempotency_records_expiry
  ON marketplace.idempotency_records (expires_at);

CREATE INDEX idempotency_records_uncertain
  ON marketplace.idempotency_records (reconciliation_due_at)
  WHERE status = 'UNCERTAIN';

COMMENT ON TABLE marketplace.idempotency_records IS
  'Actor- and command-scoped idempotency outcomes; payload content is represented only by a canonical SHA-256 hash.';

COMMENT ON COLUMN marketplace.idempotency_records.idempotency_key IS
  'Opaque client retry key; never an authentication or authorization secret.';
