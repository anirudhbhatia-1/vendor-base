-- Phase 11: controlled local operations, trust, incident, audit and export workflows.
INSERT INTO marketplace.capabilities (capability_key,actor_kind,resource_rule,description) VALUES
 ('admin.control.dashboard_read','ADMIN','ADMIN_SCOPE','Read the scoped operations control plane'),
 ('admin.order.intervene','ADMIN','ADMIN_SCOPE','Preview and record controlled order interventions'),
 ('admin.audit.read','ADMIN','ADMIN_SCOPE','Read immutable operational audit history'),
 ('admin.reporting.read','ADMIN','ADMIN_SCOPE','Read scoped synthetic operations reports'),
 ('admin.reporting.export','ADMIN','ADMIN_SCOPE','Create protected expiring synthetic report exports')
ON CONFLICT (capability_key) DO NOTHING;
INSERT INTO marketplace.role_capabilities (role_key,capability_key) VALUES
 ('SUPPORT_AGENT','admin.control.dashboard_read'),('SUPPORT_AGENT','admin.order.intervene'),
 ('SUPPORT_AGENT','admin.audit.read'),('FINANCE_OPERATOR','admin.control.dashboard_read'),
 ('FINANCE_APPROVER','admin.control.dashboard_read'),('TRUST_OPERATOR','admin.control.dashboard_read'),
 ('TRUST_APPROVER','admin.control.dashboard_read'),('CONFIG_OPERATOR','admin.control.dashboard_read'),
 ('CONFIG_APPROVER','admin.control.dashboard_read'),('INCIDENT_COMMANDER','admin.control.dashboard_read'),
 ('INCIDENT_COMMANDER','admin.order.intervene'),('INCIDENT_COMMANDER','admin.audit.read'),
 ('INCIDENT_COMMANDER','admin.reporting.read'),('INCIDENT_COMMANDER','admin.reporting.export')
ON CONFLICT DO NOTHING;

ALTER TABLE marketplace.support_cases
  ADD COLUMN owner_user_id uuid REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  ADD COLUMN owner_team text,
  ADD COLUMN response_due_at timestamptz,
  ADD COLUMN merged_into_case_id uuid REFERENCES marketplace.support_cases(support_case_id) ON DELETE RESTRICT,
  ADD COLUMN severity text NOT NULL DEFAULT 'MEDIUM',
  ADD CONSTRAINT support_case_severity CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL'));
CREATE TABLE marketplace.support_case_events (
 support_case_event_id uuid PRIMARY KEY, support_case_id uuid NOT NULL REFERENCES marketplace.support_cases(support_case_id) ON DELETE RESTRICT,
 event_type text NOT NULL, actor_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
 reason_code text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, request_id uuid NOT NULL, correlation_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(event_type IN ('OPENED','ASSIGNED','NOTE_ADDED','MESSAGE_SENT','EVIDENCE_ATTACHED','RESOLVED','REOPENED','MERGED','ESCALATED','QUALITY_REVIEWED')),
 CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'));
CREATE TABLE marketplace.support_case_messages (
 support_case_message_id uuid PRIMARY KEY, support_case_id uuid NOT NULL REFERENCES marketplace.support_cases(support_case_id) ON DELETE RESTRICT,
 author_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT, audience text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(audience IN ('INTERNAL','PARTICIPANT')), CHECK(length(body) BETWEEN 1 AND 2000));
CREATE TABLE marketplace.support_case_evidence (
 support_case_evidence_id uuid PRIMARY KEY, support_case_id uuid NOT NULL REFERENCES marketplace.support_cases(support_case_id) ON DELETE RESTRICT,
 evidence_reference text NOT NULL, classification text NOT NULL DEFAULT 'INTERNAL', attached_by_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(support_case_id,evidence_reference), CHECK(evidence_reference ~ '^SYNTH-EVIDENCE-[A-Z0-9-]{4,64}$'), CHECK(classification IN ('INTERNAL','RESTRICTED')));

CREATE TABLE marketplace.trust_restriction_cases (
 trust_restriction_case_id uuid PRIMARY KEY, subject_kind text NOT NULL, subject_reference text NOT NULL, scope_kind text NOT NULL, scope_reference text NOT NULL,
 lifecycle_state text NOT NULL DEFAULT 'PROPOSED', reason_code text NOT NULL, evidence_reference text NOT NULL, policy_reference text NOT NULL,
 proposed_by_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT, approved_by_user_id uuid REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
 effective_until timestamptz NOT NULL, review_at timestamptz NOT NULL, version integer NOT NULL DEFAULT 1, request_id uuid NOT NULL, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(subject_kind IN ('CUSTOMER','VENDOR_LOCATION','PARTNER','CATEGORY')), CHECK(scope_kind IN ('GLOBAL','ZONE','VENDOR_LOCATION','CATEGORY')),
 CHECK(lifecycle_state IN ('PROPOSED','ACTIVE','REJECTED','EXPIRED','REVOKED')), CHECK(approved_by_user_id IS NULL OR approved_by_user_id <> proposed_by_user_id),
 CHECK(effective_until > created_at), CHECK(review_at <= effective_until), CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'), CHECK(evidence_reference ~ '^SYNTH-EVIDENCE-[A-Z0-9-]{4,64}$'), CHECK(policy_reference ~ '^SYNTH-POLICY-[A-Z0-9-]{4,64}$'));
CREATE TABLE marketplace.incident_controls (
 incident_control_id uuid PRIMARY KEY, control_key text NOT NULL, scope_kind text NOT NULL, scope_reference text NOT NULL, lifecycle_state text NOT NULL DEFAULT 'ACTIVE', reason_code text NOT NULL, owner_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT, expires_at timestamptz NOT NULL, review_at timestamptz NOT NULL, obligations jsonb NOT NULL, request_id uuid NOT NULL, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(control_key,scope_kind,scope_reference), CHECK(control_key IN ('VENDOR_PAUSE','CATEGORY_PAUSE','ZONE_PAUSE','DELIVERY_PAUSE','PARTNER_ASSIGNMENT_PAUSE','PAYMENT_PAUSE','PROMOTION_PAUSE','SUBSTITUTION_PAUSE','GROUPED_CHECKOUT_PAUSE','PAYOUT_PAUSE')), CHECK(lifecycle_state IN ('ACTIVE','REVOKED','EXPIRED')), CHECK(expires_at > created_at), CHECK(review_at <= expires_at), CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'));
CREATE TABLE marketplace.operational_audit_events (
 operational_audit_event_id uuid PRIMARY KEY, action text NOT NULL, target_kind text NOT NULL, target_reference text NOT NULL, actor_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT, reason_code text NOT NULL, before_value jsonb, after_value jsonb, request_id uuid NOT NULL, correlation_id uuid NOT NULL, approval_reference uuid, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(action ~ '^[A-Z][A-Z0-9_]{2,63}$'), CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'));
CREATE INDEX operational_audit_search ON marketplace.operational_audit_events(actor_id,action,target_kind,target_reference,occurred_at DESC);
CREATE TABLE marketplace.report_exports (
 report_export_id uuid PRIMARY KEY, report_kind text NOT NULL, filters jsonb NOT NULL, classification text NOT NULL, exported_by_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT, expires_at timestamptz NOT NULL, download_token_hash text NOT NULL UNIQUE, request_id uuid NOT NULL, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(report_kind IN ('CUSTOMER_FUNNEL','MARKETPLACE','VENDOR_HEALTH','DELIVERY_OPERATIONS','FINANCE','SUPPORT','RISK')), CHECK(classification IN ('INTERNAL','RESTRICTED')), CHECK(expires_at > created_at));

CREATE TRIGGER support_case_events_append_only BEFORE UPDATE OR DELETE ON marketplace.support_case_events FOR EACH ROW EXECUTE FUNCTION marketplace.protect_configuration_history();
CREATE TRIGGER support_case_messages_append_only BEFORE UPDATE OR DELETE ON marketplace.support_case_messages FOR EACH ROW EXECUTE FUNCTION marketplace.protect_configuration_history();
CREATE TRIGGER support_case_evidence_append_only BEFORE UPDATE OR DELETE ON marketplace.support_case_evidence FOR EACH ROW EXECUTE FUNCTION marketplace.protect_configuration_history();
CREATE TRIGGER operational_audit_events_append_only BEFORE UPDATE OR DELETE ON marketplace.operational_audit_events FOR EACH ROW EXECUTE FUNCTION marketplace.protect_configuration_history();
