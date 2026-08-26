DROP TRIGGER IF EXISTS access_membership_events_append_only
  ON marketplace.access_membership_events;
DROP TRIGGER IF EXISTS admin_membership_scope_subtype
  ON marketplace.admin_membership_scopes;
DROP TRIGGER IF EXISTS partner_eligibility_subtype
  ON marketplace.partner_eligibilities;
DROP TRIGGER IF EXISTS staff_membership_subtype
  ON marketplace.staff_memberships;
DROP TRIGGER IF EXISTS role_assignment_separation
  ON marketplace.role_assignments;
DROP FUNCTION IF EXISTS marketplace.enforce_role_assignment_subtype();
DROP FUNCTION IF EXISTS marketplace.enforce_role_assignment_separation();
DROP TABLE IF EXISTS marketplace.access_membership_events;
DROP TABLE IF EXISTS marketplace.admin_membership_scopes;
DROP TABLE IF EXISTS marketplace.partner_assignment_memberships;
DROP TABLE IF EXISTS marketplace.partner_eligibilities;
DROP TABLE IF EXISTS marketplace.staff_memberships;
DROP TABLE IF EXISTS marketplace.role_assignments;
DROP TABLE IF EXISTS marketplace.role_separation_rules;
DROP TABLE IF EXISTS marketplace.role_capabilities;
DROP TABLE IF EXISTS marketplace.roles;
DROP TABLE IF EXISTS marketplace.capabilities;
