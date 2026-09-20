-- Reading the policy register is not proposing a change to it.
--
-- The register's list was gated on admin.configuration.propose, held by the
-- CONFIG_OPERATOR alone; the CONFIG_APPROVER, whose whole job is to read a
-- proposed version and approve or reject it, could not open the list (404
-- by concealment), and the bootstrap admin holds the approver side. Both
-- sides of the maker-checker pair may read.
INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description) VALUES
  ('admin.configuration.read', 'ADMIN', 'ADMIN_SCOPE', 'Read configuration versions within scope')
ON CONFLICT DO NOTHING;
INSERT INTO marketplace.role_capabilities (role_key, capability_key) VALUES
  ('CONFIG_OPERATOR', 'admin.configuration.read'),
  ('CONFIG_APPROVER', 'admin.configuration.read')
ON CONFLICT DO NOTHING;
