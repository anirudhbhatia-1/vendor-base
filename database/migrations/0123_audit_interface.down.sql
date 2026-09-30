DELETE FROM marketplace.role_capabilities
 WHERE capability_key = 'admin.audit.read'
   AND role_key IN ('FINANCE_APPROVER', 'TRUST_APPROVER', 'CONFIG_APPROVER');

DROP INDEX marketplace.operational_audit_by_reason;
DROP INDEX marketplace.operational_audit_by_target;
DROP INDEX marketplace.operational_audit_by_approval;
DROP INDEX marketplace.operational_audit_by_request;
DROP INDEX marketplace.operational_audit_by_time;

DROP TRIGGER operational_audit_events_no_truncate ON marketplace.operational_audit_events;
DROP FUNCTION marketplace.protect_operational_audit_truncate();

-- Not validated: rows written since 0123 may name actors with no user row.
ALTER TABLE marketplace.operational_audit_events
  ADD CONSTRAINT operational_audit_events_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES marketplace.users (user_id) ON DELETE RESTRICT NOT VALID;
