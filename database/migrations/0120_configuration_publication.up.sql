-- 11.6: a configuration change can be turned down or called off, and it
-- carries the validation its approver read.
--
-- Until audit run 78 a draft could not be rejected nor a schedule cancelled
-- -- the lifecycle allowed only forward steps -- so a wrong proposal sat as
-- a draft for ever and a wrong schedule could only be overtaken; and
-- validating a version recorded nothing about what had been checked.

ALTER TABLE marketplace.configuration_versions
  ADD COLUMN validation_report jsonb,
  -- An actor id like proposed_by and approved_by: no foreign key, so the
  -- register never joins a cascade from the people tables.
  ADD COLUMN closed_by uuid,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closing_reason_code text;

ALTER TABLE marketplace.configuration_versions
  DROP CONSTRAINT configuration_status_allowed,
  ADD CONSTRAINT configuration_status_allowed CHECK (status IN
    ('DRAFT', 'VALIDATED', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'CANCELLED')),
  DROP CONSTRAINT configuration_status_shape,
  ADD CONSTRAINT configuration_status_shape CHECK (
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
    OR
    -- Turned down before it took force, or called off while scheduled: never
    -- active, and closed by a named person for a reason.
    (status IN ('REJECTED', 'CANCELLED')
      AND activated_at IS NULL AND superseded_at IS NULL)
  ),
  ADD CONSTRAINT configuration_closed_shape CHECK (
    (status IN ('REJECTED', 'CANCELLED'))
    = (closed_by IS NOT NULL AND closed_at IS NOT NULL AND closing_reason_code IS NOT NULL)
  ),
  ADD CONSTRAINT configuration_closing_reason CHECK
    (closing_reason_code IS NULL OR closing_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  ADD CONSTRAINT configuration_validation_report_shape CHECK
    (validation_report IS NULL OR jsonb_typeof(validation_report) = 'object');

ALTER TABLE marketplace.configuration_lifecycle_events
  DROP CONSTRAINT configuration_lifecycle_from_status,
  ADD CONSTRAINT configuration_lifecycle_from_status CHECK (from_status IS NULL OR from_status IN
    ('DRAFT', 'VALIDATED', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED')),
  DROP CONSTRAINT configuration_lifecycle_to_status,
  ADD CONSTRAINT configuration_lifecycle_to_status CHECK (to_status IN
    ('DRAFT', 'VALIDATED', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'CANCELLED'));

-- The lifecycle: forward as before, plus a rejection before scheduling and a
-- cancellation while scheduled. The report is written once, at validation.
CREATE OR REPLACE FUNCTION marketplace.protect_configuration_version()
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
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.validation_report IS DISTINCT FROM OLD.validation_report
         AND NOT (OLD.status = 'DRAFT' AND NEW.status = 'VALIDATED')) THEN
    RAISE EXCEPTION 'configuration version content is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status = 'VALIDATED')
    OR (OLD.status = 'VALIDATED' AND NEW.status = 'APPROVED')
    OR (OLD.status = 'APPROVED' AND NEW.status = 'SCHEDULED')
    OR (OLD.status = 'SCHEDULED' AND NEW.status = 'ACTIVE')
    OR (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')
    OR (OLD.status IN ('DRAFT', 'VALIDATED', 'APPROVED') AND NEW.status = 'REJECTED')
    OR (OLD.status = 'SCHEDULED' AND NEW.status = 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'invalid configuration lifecycle transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
