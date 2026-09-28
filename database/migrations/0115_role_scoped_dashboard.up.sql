-- 11.1: every admin role opens the dashboard, which shows each operator only
-- the rows their capabilities let them act on.
--
-- Until audit run 73 the dashboard returned every queue's rows to anyone who
-- could open it, and six admin roles could not open it at all -- a delivery
-- operator, a catalogue moderator and the vendor onboarding and publication
-- staff had no view of their own work there.
INSERT INTO marketplace.role_capabilities (role_key, capability_key)
SELECT role.role_key, 'admin.control.dashboard_read'
  FROM marketplace.roles role
 WHERE role.actor_kind = 'ADMIN'
ON CONFLICT DO NOTHING;
