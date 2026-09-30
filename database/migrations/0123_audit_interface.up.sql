-- 11.9: the operational audit is searchable by every field an investigation
-- starts from, and nothing an admin can reach removes a row from it.
--
-- Until audit run 81 rows could not be updated or deleted, but the table
-- could be truncated, and its actor foreign key meant truncating the people
-- table with CASCADE emptied it too; and it could be searched only by a
-- substring of three columns.

-- An actor id like the rest of the register: no foreign key, so no cascade
-- from the people tables reaches the audit.
ALTER TABLE marketplace.operational_audit_events
  DROP CONSTRAINT operational_audit_events_actor_id_fkey;

CREATE FUNCTION marketplace.protect_operational_audit_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'the operational audit cannot be truncated'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER operational_audit_events_no_truncate
  BEFORE TRUNCATE ON marketplace.operational_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION marketplace.protect_operational_audit_truncate();

-- The fields a search starts from.
CREATE INDEX operational_audit_by_time
  ON marketplace.operational_audit_events (occurred_at DESC, operational_audit_event_id DESC);
CREATE INDEX operational_audit_by_request
  ON marketplace.operational_audit_events (request_id);
CREATE INDEX operational_audit_by_approval
  ON marketplace.operational_audit_events (approval_reference)
  WHERE approval_reference IS NOT NULL;
CREATE INDEX operational_audit_by_target
  ON marketplace.operational_audit_events (target_kind, target_reference, occurred_at DESC);
CREATE INDEX operational_audit_by_reason
  ON marketplace.operational_audit_events (reason_code, occurred_at DESC);

-- The approvers of each domain read the audit of what their teams did.
INSERT INTO marketplace.role_capabilities (role_key, capability_key) VALUES
  ('FINANCE_APPROVER', 'admin.audit.read'),
  ('TRUST_APPROVER', 'admin.audit.read'),
  ('CONFIG_APPROVER', 'admin.audit.read')
ON CONFLICT DO NOTHING;
