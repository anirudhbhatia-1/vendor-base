-- Rejections, cancellations and validation reports cannot be represented before this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.configuration_versions
              WHERE status IN ('REJECTED', 'CANCELLED') OR validation_report IS NOT NULL) THEN
    RAISE EXCEPTION 'configuration publication history exists; 0120 cannot be rolled back'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

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

ALTER TABLE marketplace.configuration_lifecycle_events
  DROP CONSTRAINT configuration_lifecycle_to_status,
  ADD CONSTRAINT configuration_lifecycle_to_status CHECK (to_status IN
    ('DRAFT', 'VALIDATED', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED'));

ALTER TABLE marketplace.configuration_versions
  DROP CONSTRAINT configuration_validation_report_shape,
  DROP CONSTRAINT configuration_closing_reason,
  DROP CONSTRAINT configuration_closed_shape,
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
  ),
  DROP CONSTRAINT configuration_status_allowed,
  ADD CONSTRAINT configuration_status_allowed CHECK (status IN
    ('DRAFT', 'VALIDATED', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED')),
  DROP COLUMN closing_reason_code,
  DROP COLUMN closed_at,
  DROP COLUMN closed_by,
  DROP COLUMN validation_report;
