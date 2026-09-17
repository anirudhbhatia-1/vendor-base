-- Two capabilities the partner surface needs, and could not borrow.
--
-- `partner.assignment.act` carries the ACTIVE_ASSIGNMENT resource rule, which
-- only grants when the request supplies a `delivery_assignment_id` that matches
-- the caller's active assignment. That is right for acting on a delivery, and
-- wrong for two things the partner surface also has to do:
--
--   * list the proofs this partner is still holding, which is not about one
--     assignment and is exactly what should be readable when the app restarts;
--   * sync one of those proofs, which is addressed by proof id, not by
--     assignment.
--
-- Reusing `partner.assignment.act` for them meant the guard had no assignment
-- to check, so the rule could never grant and the routes answered "not found"
-- to their own owner. These are PARTNER_SELF: scoped to the caller, needing no
-- assignment, and the services already filter every row by partner.
--
-- `partner.standing.read` covers the same shape for restrictions and the
-- partner's own application — DLP-47 and DLP-56 require the person restricted
-- to be able to read the reason, the review date and the appeal route.

INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description)
VALUES
  ('partner.field.read', 'PARTNER', 'PARTNER_SELF',
    'Read the partner own held offline proofs and sync them'),
  ('partner.standing.read', 'PARTNER', 'PARTNER_SELF',
    'Read the partner own application state and any restriction against them')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES
  ('DELIVERY_PARTNER', 'partner.field.read'),
  ('DELIVERY_PARTNER', 'partner.standing.read')
ON CONFLICT (role_key, capability_key) DO NOTHING;
