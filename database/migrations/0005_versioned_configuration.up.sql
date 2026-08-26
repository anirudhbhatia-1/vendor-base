CREATE TABLE marketplace.configuration_versions (
  configuration_version_id uuid PRIMARY KEY,
  configuration_key text NOT NULL,
  version_number integer NOT NULL,
  configuration_kind text NOT NULL,
  value_type text NOT NULL,
  configuration_value jsonb NOT NULL,
  scope_kind text NOT NULL,
  scope_reference text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  proposed_by uuid NOT NULL,
  validated_by uuid,
  approved_by uuid,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  rollback_of_version_id uuid,
  effective_from timestamptz,
  effective_until timestamptz,
  validated_at timestamptz,
  approved_at timestamptz,
  activated_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT configuration_version_identity
    UNIQUE (configuration_key, scope_kind, scope_reference, version_number),
  CONSTRAINT configuration_rollback_fk
    FOREIGN KEY (rollback_of_version_id)
    REFERENCES marketplace.configuration_versions (configuration_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT configuration_key_format
    CHECK (configuration_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
      AND length(configuration_key) <= 120),
  CONSTRAINT configuration_version_positive CHECK (version_number >= 1),
  CONSTRAINT configuration_kind_allowed
    CHECK (configuration_kind IN ('SETTING', 'FEATURE_FLAG')),
  CONSTRAINT configuration_value_type_allowed
    CHECK (value_type IN ('BOOLEAN', 'INTEGER', 'STRING', 'JSON')),
  CONSTRAINT configuration_value_shape
    CHECK (
      (value_type = 'BOOLEAN' AND jsonb_typeof(configuration_value) = 'boolean')
      OR
      (value_type = 'INTEGER' AND jsonb_typeof(configuration_value) = 'number'
        AND configuration_value::text ~ '^-?(0|[1-9][0-9]*)$')
      OR
      (value_type = 'STRING' AND jsonb_typeof(configuration_value) = 'string')
      OR
      (value_type = 'JSON' AND jsonb_typeof(configuration_value) IN ('object', 'array'))
    ),
  CONSTRAINT configuration_value_size
    CHECK (octet_length(configuration_value::text) <= 65536),
  CONSTRAINT feature_flag_boolean
    CHECK (configuration_kind <> 'FEATURE_FLAG' OR value_type = 'BOOLEAN'),
  CONSTRAINT configuration_scope_kind_allowed
    CHECK (scope_kind IN ('GLOBAL', 'INTERNAL_USER', 'VENDOR', 'CATEGORY', 'ZONE', 'COHORT')),
  CONSTRAINT configuration_scope_reference_format
    CHECK (
      (scope_kind = 'GLOBAL' AND scope_reference = 'global')
      OR
      (scope_kind <> 'GLOBAL' AND scope_reference ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]{0,119}$')
    ),
  CONSTRAINT configuration_status_allowed
    CHECK (status IN ('DRAFT', 'VALIDATED', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED')),
  CONSTRAINT configuration_effective_window
    CHECK (effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until > effective_from)),
  CONSTRAINT configuration_maker_checker
    CHECK (approved_by IS NULL OR approved_by <> proposed_by),
  CONSTRAINT configuration_rollback_not_self
    CHECK (rollback_of_version_id IS NULL OR rollback_of_version_id <> configuration_version_id),
  CONSTRAINT configuration_status_shape
    CHECK (
      (status = 'DRAFT'
        AND validated_by IS NULL AND approved_by IS NULL
        AND validated_at IS NULL AND approved_at IS NULL
        AND effective_from IS NULL AND activated_at IS NULL AND superseded_at IS NULL)
      OR
      (status = 'VALIDATED'
        AND validated_by IS NOT NULL AND approved_by IS NULL
        AND validated_at IS NOT NULL AND approved_at IS NULL
        AND effective_from IS NULL AND activated_at IS NULL AND superseded_at IS NULL)
      OR
      (status = 'APPROVED'
        AND validated_by IS NOT NULL AND approved_by IS NOT NULL
        AND validated_at IS NOT NULL AND approved_at IS NOT NULL
        AND effective_from IS NULL AND activated_at IS NULL AND superseded_at IS NULL)
      OR
      (status = 'SCHEDULED'
        AND validated_by IS NOT NULL AND approved_by IS NOT NULL
        AND validated_at IS NOT NULL AND approved_at IS NOT NULL
        AND effective_from IS NOT NULL AND activated_at IS NULL AND superseded_at IS NULL)
      OR
      (status = 'ACTIVE'
        AND validated_by IS NOT NULL AND approved_by IS NOT NULL
        AND validated_at IS NOT NULL AND approved_at IS NOT NULL
        AND effective_from IS NOT NULL AND activated_at IS NOT NULL AND superseded_at IS NULL)
      OR
      (status = 'SUPERSEDED'
        AND validated_by IS NOT NULL AND approved_by IS NOT NULL
        AND validated_at IS NOT NULL AND approved_at IS NOT NULL
        AND effective_from IS NOT NULL AND activated_at IS NOT NULL AND superseded_at IS NOT NULL
        AND effective_until IS NOT NULL)
    )
);

CREATE UNIQUE INDEX one_active_configuration_per_scope
  ON marketplace.configuration_versions (configuration_key, scope_kind, scope_reference)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX one_scheduled_configuration_per_scope
  ON marketplace.configuration_versions (configuration_key, scope_kind, scope_reference)
  WHERE status = 'SCHEDULED';

CREATE INDEX configuration_versions_resolution
  ON marketplace.configuration_versions
    (configuration_key, configuration_kind, status, scope_kind, scope_reference, effective_from);

CREATE INDEX configuration_versions_rollback
  ON marketplace.configuration_versions (rollback_of_version_id)
  WHERE rollback_of_version_id IS NOT NULL;

CREATE TABLE marketplace.configuration_lifecycle_events (
  event_id uuid PRIMARY KEY,
  configuration_version_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  reason_code text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT configuration_lifecycle_version_fk
    FOREIGN KEY (configuration_version_id)
    REFERENCES marketplace.configuration_versions (configuration_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT configuration_lifecycle_from_status
    CHECK (from_status IS NULL OR from_status IN
      ('DRAFT', 'VALIDATED', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED')),
  CONSTRAINT configuration_lifecycle_to_status
    CHECK (to_status IN ('DRAFT', 'VALIDATED', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED')),
  CONSTRAINT configuration_lifecycle_reason_format
    CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

CREATE INDEX configuration_lifecycle_history
  ON marketplace.configuration_lifecycle_events (configuration_version_id, occurred_at, event_id);

CREATE TABLE marketplace.business_configuration_snapshots (
  business_record_type text NOT NULL,
  business_record_id uuid NOT NULL,
  configuration_key text NOT NULL,
  configuration_version_id uuid NOT NULL,
  snapshotted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT business_configuration_snapshot_pk
    PRIMARY KEY (business_record_type, business_record_id, configuration_key),
  CONSTRAINT business_configuration_version_fk
    FOREIGN KEY (configuration_version_id)
    REFERENCES marketplace.configuration_versions (configuration_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT business_record_type_format
    CHECK (business_record_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT business_snapshot_key_format
    CHECK (configuration_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
      AND length(configuration_key) <= 120)
);

CREATE INDEX business_configuration_snapshot_version
  ON marketplace.business_configuration_snapshots (configuration_version_id);

CREATE FUNCTION marketplace.protect_configuration_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'configuration versions cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.configuration_version_id IS DISTINCT FROM OLD.configuration_version_id
     OR NEW.configuration_key IS DISTINCT FROM OLD.configuration_key
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.configuration_kind IS DISTINCT FROM OLD.configuration_kind
     OR NEW.value_type IS DISTINCT FROM OLD.value_type
     OR NEW.configuration_value IS DISTINCT FROM OLD.configuration_value
     OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
     OR NEW.scope_reference IS DISTINCT FROM OLD.scope_reference
     OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.rollback_of_version_id IS DISTINCT FROM OLD.rollback_of_version_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'configuration version content is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status = 'VALIDATED')
    OR (OLD.status = 'VALIDATED' AND NEW.status = 'APPROVED')
    OR (OLD.status = 'APPROVED' AND NEW.status = 'SCHEDULED')
    OR (OLD.status = 'SCHEDULED' AND NEW.status = 'ACTIVE')
    OR (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'invalid configuration lifecycle transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER configuration_version_controlled_lifecycle
BEFORE UPDATE OR DELETE ON marketplace.configuration_versions
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_configuration_version();

CREATE FUNCTION marketplace.protect_configuration_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'configuration history is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER configuration_lifecycle_append_only
BEFORE UPDATE OR DELETE ON marketplace.configuration_lifecycle_events
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_configuration_history();

CREATE TRIGGER business_configuration_snapshots_append_only
BEFORE UPDATE OR DELETE ON marketplace.business_configuration_snapshots
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_configuration_history();

COMMENT ON TABLE marketplace.configuration_versions IS
  'Immutable scoped configuration content with controlled maker-checker lifecycle.';

COMMENT ON TABLE marketplace.configuration_lifecycle_events IS
  'Append-only attributable validation, approval, scheduling, activation and supersession history.';

COMMENT ON TABLE marketplace.business_configuration_snapshots IS
  'Immutable configuration versions used when a business record was created.';
