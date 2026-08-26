CREATE TABLE marketplace.capabilities (
  capability_key text PRIMARY KEY,
  actor_kind text NOT NULL,
  resource_rule text NOT NULL,
  description text NOT NULL,
  CONSTRAINT capability_key_shape CHECK (capability_key ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){2,5}$'),
  CONSTRAINT capability_actor_kind_allowed CHECK
    (actor_kind IN ('CUSTOMER', 'VENDOR_STAFF', 'PARTNER', 'ADMIN')),
  CONSTRAINT capability_resource_rule_allowed CHECK
    (resource_rule IN ('ACCOUNT', 'VENDOR_LOCATION', 'PARTNER_SELF', 'ACTIVE_ASSIGNMENT', 'ADMIN_SCOPE')),
  CONSTRAINT capability_description_shape CHECK (length(description) BETWEEN 1 AND 200)
);

CREATE TABLE marketplace.roles (
  role_key text PRIMARY KEY,
  actor_kind text NOT NULL,
  assignment_scope text NOT NULL,
  description text NOT NULL,
  CONSTRAINT role_key_shape CHECK (role_key ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT role_actor_kind_allowed CHECK
    (actor_kind IN ('CUSTOMER', 'VENDOR_STAFF', 'PARTNER', 'ADMIN')),
  CONSTRAINT role_assignment_scope_allowed CHECK
    (assignment_scope IN ('ACCOUNT', 'VENDOR_LOCATION', 'PARTNER', 'ADMIN_SCOPE')),
  CONSTRAINT role_description_shape CHECK (length(description) BETWEEN 1 AND 200)
);

CREATE TABLE marketplace.role_capabilities (
  role_key text NOT NULL,
  capability_key text NOT NULL,
  PRIMARY KEY (role_key, capability_key),
  CONSTRAINT role_capability_role_fk FOREIGN KEY (role_key)
    REFERENCES marketplace.roles (role_key) ON DELETE RESTRICT,
  CONSTRAINT role_capability_capability_fk FOREIGN KEY (capability_key)
    REFERENCES marketplace.capabilities (capability_key) ON DELETE RESTRICT
);

CREATE TABLE marketplace.role_separation_rules (
  first_role_key text NOT NULL,
  second_role_key text NOT NULL,
  reason_code text NOT NULL,
  PRIMARY KEY (first_role_key, second_role_key),
  CONSTRAINT role_separation_first_fk FOREIGN KEY (first_role_key)
    REFERENCES marketplace.roles (role_key) ON DELETE RESTRICT,
  CONSTRAINT role_separation_second_fk FOREIGN KEY (second_role_key)
    REFERENCES marketplace.roles (role_key) ON DELETE RESTRICT,
  CONSTRAINT role_separation_order CHECK (first_role_key < second_role_key),
  CONSTRAINT role_separation_reason_shape CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

CREATE TABLE marketplace.role_assignments (
  role_assignment_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  role_key text NOT NULL,
  state text NOT NULL DEFAULT 'ACTIVE',
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  granted_by_user_id uuid,
  revoked_at timestamptz,
  revoke_reason text,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT role_assignment_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT role_assignment_role_fk FOREIGN KEY (role_key)
    REFERENCES marketplace.roles (role_key) ON DELETE RESTRICT,
  CONSTRAINT role_assignment_grantor_fk FOREIGN KEY (granted_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT role_assignment_state_allowed CHECK (state IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT role_assignment_validity CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT role_assignment_revocation_shape CHECK (
    (state = 'ACTIVE' AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (state = 'REVOKED' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  ),
  CONSTRAINT role_assignment_revoke_reason_shape CHECK
    (revoke_reason IS NULL OR revoke_reason ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

CREATE INDEX role_assignments_user_active
  ON marketplace.role_assignments (user_id, role_key, valid_from, valid_until)
  WHERE state = 'ACTIVE';

CREATE TABLE marketplace.staff_memberships (
  staff_membership_id uuid PRIMARY KEY,
  role_assignment_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  vendor_location_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT staff_membership_assignment_fk FOREIGN KEY (role_assignment_id)
    REFERENCES marketplace.role_assignments (role_assignment_id) ON DELETE RESTRICT,
  CONSTRAINT staff_membership_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT staff_membership_unique UNIQUE (user_id, vendor_location_id, role_assignment_id)
);

CREATE INDEX staff_memberships_location_user
  ON marketplace.staff_memberships (vendor_location_id, user_id, role_assignment_id);

CREATE TABLE marketplace.partner_eligibilities (
  partner_eligibility_id uuid PRIMARY KEY,
  role_assignment_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL UNIQUE,
  state text NOT NULL,
  eligible_from timestamptz,
  eligible_until timestamptz,
  reason_code text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT partner_eligibility_assignment_fk FOREIGN KEY (role_assignment_id)
    REFERENCES marketplace.role_assignments (role_assignment_id) ON DELETE RESTRICT,
  CONSTRAINT partner_eligibility_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT partner_eligibility_state_allowed CHECK
    (state IN ('PENDING', 'ELIGIBLE', 'RESTRICTED', 'SUSPENDED')),
  CONSTRAINT partner_eligibility_window CHECK
    (eligible_until IS NULL OR (eligible_from IS NOT NULL AND eligible_until > eligible_from)),
  CONSTRAINT partner_eligibility_active_shape CHECK
    ((state = 'ELIGIBLE' AND eligible_from IS NOT NULL) OR state <> 'ELIGIBLE'),
  CONSTRAINT partner_eligibility_reason_shape CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT partner_eligibility_version_positive CHECK (version >= 1)
);

CREATE TABLE marketplace.partner_assignment_memberships (
  partner_assignment_membership_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  delivery_assignment_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'ACTIVE',
  activated_at timestamptz NOT NULL,
  ended_at timestamptz,
  reason_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT partner_assignment_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT partner_assignment_state_allowed CHECK (state IN ('ACTIVE', 'ENDED')),
  CONSTRAINT partner_assignment_state_shape CHECK (
    (state = 'ACTIVE' AND ended_at IS NULL)
    OR (state = 'ENDED' AND ended_at IS NOT NULL AND ended_at >= activated_at)
  ),
  CONSTRAINT partner_assignment_reason_shape CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

CREATE UNIQUE INDEX one_active_assignment_per_partner
  ON marketplace.partner_assignment_memberships (user_id)
  WHERE state = 'ACTIVE';

CREATE UNIQUE INDEX one_active_partner_per_assignment
  ON marketplace.partner_assignment_memberships (delivery_assignment_id)
  WHERE state = 'ACTIVE';

CREATE TABLE marketplace.admin_membership_scopes (
  admin_membership_scope_id uuid PRIMARY KEY,
  role_assignment_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  scope_kind text NOT NULL,
  scope_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT admin_scope_assignment_fk FOREIGN KEY (role_assignment_id)
    REFERENCES marketplace.role_assignments (role_assignment_id) ON DELETE RESTRICT,
  CONSTRAINT admin_scope_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT admin_scope_kind_allowed CHECK
    (scope_kind IN ('GLOBAL', 'ZONE', 'VENDOR_LOCATION')),
  CONSTRAINT admin_scope_shape CHECK (
    (scope_kind = 'GLOBAL' AND scope_id IS NULL)
    OR (scope_kind <> 'GLOBAL' AND scope_id IS NOT NULL)
  )
);

CREATE INDEX admin_membership_scopes_lookup
  ON marketplace.admin_membership_scopes (scope_kind, scope_id, user_id);

CREATE TABLE marketplace.access_membership_events (
  event_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  role_assignment_id uuid,
  event_type text NOT NULL,
  reason_code text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT access_event_user_fk FOREIGN KEY (user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT access_event_assignment_fk FOREIGN KEY (role_assignment_id)
    REFERENCES marketplace.role_assignments (role_assignment_id) ON DELETE RESTRICT,
  CONSTRAINT access_event_type_allowed CHECK (event_type IN
    ('ROLE_GRANTED', 'ROLE_REVOKED', 'PARTNER_ELIGIBILITY_CHANGED',
     'PARTNER_ASSIGNMENT_ACTIVATED', 'PARTNER_ASSIGNMENT_ENDED')),
  CONSTRAINT access_event_reason_shape CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

CREATE INDEX access_membership_events_user_history
  ON marketplace.access_membership_events (user_id, occurred_at, event_id);

CREATE FUNCTION marketplace.enforce_role_assignment_separation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state = 'ACTIVE' AND EXISTS (
    SELECT 1
      FROM marketplace.role_assignments existing
      JOIN marketplace.role_separation_rules rule
        ON (rule.first_role_key = LEAST(existing.role_key, NEW.role_key)
        AND rule.second_role_key = GREATEST(existing.role_key, NEW.role_key))
     WHERE existing.user_id = NEW.user_id
       AND existing.role_assignment_id <> NEW.role_assignment_id
       AND existing.state = 'ACTIVE'
       AND existing.valid_from < COALESCE(NEW.valid_until, 'infinity'::timestamptz)
       AND NEW.valid_from < COALESCE(existing.valid_until, 'infinity'::timestamptz)
  ) THEN
    RAISE EXCEPTION 'separation-of-duty conflict' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER role_assignment_separation
BEFORE INSERT OR UPDATE OF user_id, role_key, state, valid_from, valid_until
ON marketplace.role_assignments
FOR EACH ROW
EXECUTE FUNCTION marketplace.enforce_role_assignment_separation();

CREATE FUNCTION marketplace.enforce_role_assignment_subtype()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_scope text;
  linked_user uuid;
BEGIN
  SELECT role.assignment_scope, assignment.user_id INTO expected_scope, linked_user
    FROM marketplace.role_assignments assignment
    JOIN marketplace.roles role USING (role_key)
   WHERE assignment.role_assignment_id = NEW.role_assignment_id;
  IF linked_user IS NULL OR linked_user <> NEW.user_id THEN
    RAISE EXCEPTION 'membership user does not match role assignment' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'staff_memberships' AND expected_scope <> 'VENDOR_LOCATION' THEN
    RAISE EXCEPTION 'staff membership requires vendor-location role' USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'partner_eligibilities' AND expected_scope <> 'PARTNER' THEN
    RAISE EXCEPTION 'partner eligibility requires partner role' USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'admin_membership_scopes' AND expected_scope <> 'ADMIN_SCOPE' THEN
    RAISE EXCEPTION 'admin scope requires admin role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER staff_membership_subtype
BEFORE INSERT OR UPDATE ON marketplace.staff_memberships
FOR EACH ROW EXECUTE FUNCTION marketplace.enforce_role_assignment_subtype();
CREATE TRIGGER partner_eligibility_subtype
BEFORE INSERT OR UPDATE ON marketplace.partner_eligibilities
FOR EACH ROW EXECUTE FUNCTION marketplace.enforce_role_assignment_subtype();
CREATE TRIGGER admin_membership_scope_subtype
BEFORE INSERT OR UPDATE ON marketplace.admin_membership_scopes
FOR EACH ROW EXECUTE FUNCTION marketplace.enforce_role_assignment_subtype();

CREATE TRIGGER access_membership_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.access_membership_events
FOR EACH ROW
EXECUTE FUNCTION marketplace.protect_configuration_history();

INSERT INTO marketplace.capabilities
  (capability_key, actor_kind, resource_rule, description)
VALUES
  ('customer.account.read', 'CUSTOMER', 'ACCOUNT', 'Read the authenticated customer account'),
  ('customer.account.manage', 'CUSTOMER', 'ACCOUNT', 'Manage the authenticated customer account'),
  ('vendor.location.read', 'VENDOR_STAFF', 'VENDOR_LOCATION', 'Read an assigned vendor location'),
  ('vendor.catalogue.manage', 'VENDOR_STAFF', 'VENDOR_LOCATION', 'Manage catalogue at an assigned vendor location'),
  ('vendor.order.manage', 'VENDOR_STAFF', 'VENDOR_LOCATION', 'Manage orders at an assigned vendor location'),
  ('partner.eligibility.read', 'PARTNER', 'PARTNER_SELF', 'Read the authenticated partner eligibility'),
  ('partner.assignment.read', 'PARTNER', 'ACTIVE_ASSIGNMENT', 'Read the active delivery assignment'),
  ('partner.assignment.act', 'PARTNER', 'ACTIVE_ASSIGNMENT', 'Act on the active delivery assignment'),
  ('admin.support.case_manage', 'ADMIN', 'ADMIN_SCOPE', 'Manage support cases within scope'),
  ('admin.finance.refund_propose', 'ADMIN', 'ADMIN_SCOPE', 'Propose refunds within scope'),
  ('admin.finance.refund_approve', 'ADMIN', 'ADMIN_SCOPE', 'Approve refunds within scope'),
  ('admin.trust.restriction_propose', 'ADMIN', 'ADMIN_SCOPE', 'Propose trust restrictions within scope'),
  ('admin.trust.restriction_approve', 'ADMIN', 'ADMIN_SCOPE', 'Approve trust restrictions within scope'),
  ('admin.configuration.propose', 'ADMIN', 'ADMIN_SCOPE', 'Propose configuration changes within scope'),
  ('admin.configuration.approve', 'ADMIN', 'ADMIN_SCOPE', 'Approve configuration changes within scope'),
  ('admin.incident.manage', 'ADMIN', 'ADMIN_SCOPE', 'Manage incident controls within scope');

INSERT INTO marketplace.roles (role_key, actor_kind, assignment_scope, description)
VALUES
  ('CUSTOMER', 'CUSTOMER', 'ACCOUNT', 'Customer account holder'),
  ('VENDOR_OWNER', 'VENDOR_STAFF', 'VENDOR_LOCATION', 'Vendor location owner'),
  ('VENDOR_MANAGER', 'VENDOR_STAFF', 'VENDOR_LOCATION', 'Vendor location manager'),
  ('VENDOR_PICKER', 'VENDOR_STAFF', 'VENDOR_LOCATION', 'Vendor location picker'),
  ('DELIVERY_PARTNER', 'PARTNER', 'PARTNER', 'Eligible delivery partner'),
  ('SUPPORT_AGENT', 'ADMIN', 'ADMIN_SCOPE', 'Scoped support operator'),
  ('FINANCE_OPERATOR', 'ADMIN', 'ADMIN_SCOPE', 'Scoped finance maker'),
  ('FINANCE_APPROVER', 'ADMIN', 'ADMIN_SCOPE', 'Scoped finance checker'),
  ('TRUST_OPERATOR', 'ADMIN', 'ADMIN_SCOPE', 'Scoped trust maker'),
  ('TRUST_APPROVER', 'ADMIN', 'ADMIN_SCOPE', 'Scoped trust checker'),
  ('CONFIG_OPERATOR', 'ADMIN', 'ADMIN_SCOPE', 'Scoped configuration maker'),
  ('CONFIG_APPROVER', 'ADMIN', 'ADMIN_SCOPE', 'Scoped configuration checker'),
  ('INCIDENT_COMMANDER', 'ADMIN', 'ADMIN_SCOPE', 'Scoped incident operator');

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES
  ('CUSTOMER', 'customer.account.read'),
  ('CUSTOMER', 'customer.account.manage'),
  ('VENDOR_OWNER', 'vendor.location.read'),
  ('VENDOR_OWNER', 'vendor.catalogue.manage'),
  ('VENDOR_OWNER', 'vendor.order.manage'),
  ('VENDOR_MANAGER', 'vendor.location.read'),
  ('VENDOR_MANAGER', 'vendor.catalogue.manage'),
  ('VENDOR_MANAGER', 'vendor.order.manage'),
  ('VENDOR_PICKER', 'vendor.location.read'),
  ('VENDOR_PICKER', 'vendor.order.manage'),
  ('DELIVERY_PARTNER', 'partner.eligibility.read'),
  ('DELIVERY_PARTNER', 'partner.assignment.read'),
  ('DELIVERY_PARTNER', 'partner.assignment.act'),
  ('SUPPORT_AGENT', 'admin.support.case_manage'),
  ('FINANCE_OPERATOR', 'admin.finance.refund_propose'),
  ('FINANCE_APPROVER', 'admin.finance.refund_approve'),
  ('TRUST_OPERATOR', 'admin.trust.restriction_propose'),
  ('TRUST_APPROVER', 'admin.trust.restriction_approve'),
  ('CONFIG_OPERATOR', 'admin.configuration.propose'),
  ('CONFIG_APPROVER', 'admin.configuration.approve'),
  ('INCIDENT_COMMANDER', 'admin.incident.manage');

INSERT INTO marketplace.role_separation_rules (first_role_key, second_role_key, reason_code)
VALUES
  ('FINANCE_APPROVER', 'FINANCE_OPERATOR', 'FINANCE_MAKER_CHECKER'),
  ('TRUST_APPROVER', 'TRUST_OPERATOR', 'TRUST_MAKER_CHECKER'),
  ('CONFIG_APPROVER', 'CONFIG_OPERATOR', 'CONFIG_MAKER_CHECKER');

COMMENT ON TABLE marketplace.role_assignments IS
  'Explicit, time-bounded role grants. No user receives a role merely by signing in.';
COMMENT ON TABLE marketplace.staff_memberships IS
  'Vendor-location membership evidence; vendor locations become foreign-keyed in Phase 5.';
COMMENT ON TABLE marketplace.partner_assignment_memberships IS
  'Active-assignment authorization evidence; delivery assignments become foreign-keyed in Phase 9.';
COMMENT ON TABLE marketplace.admin_membership_scopes IS
  'Explicit global or bounded admin scopes, with maker-checker role exclusion.';
COMMENT ON TABLE marketplace.access_membership_events IS
  'Append-only role and eligibility lifecycle evidence without authorization decisions.';
