CREATE TABLE marketplace.aggregate_heads (
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  version integer NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (aggregate_type, aggregate_id),
  CONSTRAINT aggregate_type_format
    CHECK (aggregate_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT aggregate_version_positive
    CHECK (version >= 1),
  CONSTRAINT aggregate_state_format
    CHECK (state ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT aggregate_updated_after_creation
    CHECK (updated_at >= created_at)
);

CREATE TABLE marketplace.aggregate_transitions (
  transition_id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  previous_version integer NOT NULL,
  resulting_version integer NOT NULL,
  from_state text,
  to_state text NOT NULL,
  actor_id uuid NOT NULL,
  actor_kind text NOT NULL,
  reason_code text,
  evidence jsonb NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  command_record_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT aggregate_transition_head_fk
    FOREIGN KEY (aggregate_type, aggregate_id)
    REFERENCES marketplace.aggregate_heads (aggregate_type, aggregate_id)
    ON DELETE RESTRICT,
  CONSTRAINT aggregate_transition_command_fk
    FOREIGN KEY (command_record_id)
    REFERENCES marketplace.idempotency_records (record_id)
    ON DELETE RESTRICT,
  CONSTRAINT aggregate_transition_type_format
    CHECK (aggregate_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT aggregate_transition_versions
    CHECK (previous_version >= 0 AND resulting_version = previous_version + 1),
  CONSTRAINT aggregate_transition_state_format
    CHECK (
      (from_state IS NULL OR from_state ~ '^[A-Z][A-Z0-9_]{1,63}$')
      AND to_state ~ '^[A-Z][A-Z0-9_]{1,63}$'
    ),
  CONSTRAINT aggregate_transition_creation_shape
    CHECK (
      (previous_version = 0 AND resulting_version = 1 AND from_state IS NULL)
      OR
      (previous_version >= 1 AND from_state IS NOT NULL)
    ),
  CONSTRAINT aggregate_transition_actor_kind
    CHECK (actor_kind IN ('admin', 'customer', 'delivery_partner', 'system', 'vendor_staff')),
  CONSTRAINT aggregate_transition_reason_format
    CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT aggregate_transition_evidence_object
    CHECK (jsonb_typeof(evidence) = 'object'),
  UNIQUE (aggregate_type, aggregate_id, resulting_version)
);

CREATE INDEX aggregate_heads_by_type_state
  ON marketplace.aggregate_heads (aggregate_type, state, updated_at, aggregate_id);

CREATE INDEX aggregate_transitions_history
  ON marketplace.aggregate_transitions (aggregate_type, aggregate_id, resulting_version);

CREATE INDEX aggregate_transitions_request
  ON marketplace.aggregate_transitions (request_id);

CREATE FUNCTION marketplace.reject_aggregate_transition_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'aggregate transition history is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER aggregate_transitions_append_only
BEFORE UPDATE OR DELETE ON marketplace.aggregate_transitions
FOR EACH ROW
EXECUTE FUNCTION marketplace.reject_aggregate_transition_mutation();

COMMENT ON TABLE marketplace.aggregate_heads IS
  'Current optimistic-concurrency version and state for each domain aggregate.';

COMMENT ON TABLE marketplace.aggregate_transitions IS
  'Append-only attributable state transition history; rows must never be updated or deleted by application code.';
