-- Reading the onboarding queue is neither operating it nor reviewing it.
--
-- The queue and the case read were gated on admin.vendor_onboarding.manage,
-- held by the operator alone, while the six review actions (start review,
-- document review, approve, reject, grace, appeal review) are the reviewer's:
-- the reviewer could not open the queue or a case to act on it, and the
-- operator could open both and act on neither. Both sides may read.
INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description) VALUES
  ('admin.vendor_onboarding.read', 'ADMIN', 'ADMIN_SCOPE', 'Read the vendor onboarding queue and its cases within scope')
ON CONFLICT DO NOTHING;
INSERT INTO marketplace.role_capabilities (role_key, capability_key) VALUES
  ('VENDOR_ONBOARDING_OPERATOR', 'admin.vendor_onboarding.read'),
  ('VENDOR_ONBOARDING_REVIEWER', 'admin.vendor_onboarding.read')
ON CONFLICT DO NOTHING;
