CREATE TABLE marketplace.outbox_events (
  event_id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_by uuid,
  claim_until timestamptz,
  last_error_code text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT outbox_transition_fk
    FOREIGN KEY (aggregate_type, aggregate_id, aggregate_version)
    REFERENCES marketplace.aggregate_transitions
      (aggregate_type, aggregate_id, resulting_version)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT outbox_aggregate_type_format
    CHECK (aggregate_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT outbox_event_type_format
    CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' AND length(event_type) <= 120),
  CONSTRAINT outbox_payload_object
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT outbox_status_allowed
    CHECK (status IN ('PENDING', 'PUBLISHING', 'PUBLISHED', 'DEAD_LETTER')),
  CONSTRAINT outbox_attempt_bounds
    CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 25),
  CONSTRAINT outbox_error_code_format
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT outbox_status_shape
    CHECK (
      (status = 'PENDING' AND claimed_by IS NULL AND claim_until IS NULL AND published_at IS NULL)
      OR
      (status = 'PUBLISHING' AND claimed_by IS NOT NULL AND claim_until IS NOT NULL AND published_at IS NULL)
      OR
      (status = 'PUBLISHED' AND claimed_by IS NULL AND claim_until IS NULL AND published_at IS NOT NULL)
      OR
      (status = 'DEAD_LETTER' AND claimed_by IS NULL AND claim_until IS NULL AND published_at IS NULL)
    )
);

CREATE INDEX outbox_events_dispatch
  ON marketplace.outbox_events (status, available_at, created_at, event_id)
  WHERE status IN ('PENDING', 'PUBLISHING');

CREATE INDEX outbox_events_dead_letter
  ON marketplace.outbox_events (updated_at, event_id)
  WHERE status = 'DEAD_LETTER';

CREATE TABLE marketplace.inbox_receipts (
  consumer_scope text NOT NULL,
  event_id uuid NOT NULL,
  status text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  processed_at timestamptz,
  PRIMARY KEY (consumer_scope, event_id),
  CONSTRAINT inbox_event_fk
    FOREIGN KEY (event_id)
    REFERENCES marketplace.outbox_events (event_id)
    ON DELETE RESTRICT,
  CONSTRAINT inbox_consumer_scope_format
    CHECK (consumer_scope ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' AND length(consumer_scope) <= 120),
  CONSTRAINT inbox_status_allowed
    CHECK (status IN ('PROCESSING', 'PROCESSED')),
  CONSTRAINT inbox_status_shape
    CHECK (
      (status = 'PROCESSING' AND processed_at IS NULL)
      OR
      (status = 'PROCESSED' AND processed_at IS NOT NULL)
    )
);

CREATE INDEX inbox_receipts_event
  ON marketplace.inbox_receipts (event_id, consumer_scope);

CREATE TABLE marketplace.outbox_recoveries (
  recovery_id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  reason_code text NOT NULL,
  previous_attempt_count integer NOT NULL,
  recovered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT outbox_recovery_event_fk
    FOREIGN KEY (event_id)
    REFERENCES marketplace.outbox_events (event_id)
    ON DELETE RESTRICT,
  CONSTRAINT outbox_recovery_reason_format
    CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT outbox_recovery_attempt_count
    CHECK (previous_attempt_count >= 1)
);

CREATE INDEX outbox_recoveries_event
  ON marketplace.outbox_recoveries (event_id, recovered_at);

CREATE FUNCTION marketplace.protect_outbox_event_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type
     OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id
     OR NEW.aggregate_version IS DISTINCT FROM OLD.aggregate_version
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.causation_id IS DISTINCT FROM OLD.causation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'outbox event content is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_event_content_immutable
BEFORE UPDATE ON marketplace.outbox_events
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_outbox_event_content();

CREATE FUNCTION marketplace.protect_messaging_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'inbox_receipts'
     AND TG_OP = 'UPDATE'
     AND OLD.status = 'PROCESSING'
     AND NEW.status = 'PROCESSED'
     AND NEW.consumer_scope = OLD.consumer_scope
     AND NEW.event_id = OLD.event_id
     AND NEW.request_id = OLD.request_id
     AND NEW.correlation_id = OLD.correlation_id
     AND NEW.received_at = OLD.received_at
     AND NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'messaging history is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER inbox_receipts_controlled_update
BEFORE UPDATE OR DELETE ON marketplace.inbox_receipts
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_messaging_history();

CREATE TRIGGER outbox_events_no_delete
BEFORE DELETE ON marketplace.outbox_events
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_messaging_history();

CREATE TRIGGER outbox_recoveries_append_only
BEFORE UPDATE OR DELETE ON marketplace.outbox_recoveries
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_messaging_history();

COMMENT ON TABLE marketplace.outbox_events IS
  'Transactional domain events with bounded at-least-once publishing state.';

COMMENT ON TABLE marketplace.inbox_receipts IS
  'Per-consumer event receipts committed atomically with consumer database effects.';

COMMENT ON TABLE marketplace.outbox_recoveries IS
  'Append-only attributable recovery history for dead-lettered outbox events.';
