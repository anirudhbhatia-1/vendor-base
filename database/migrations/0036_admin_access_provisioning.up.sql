INSERT INTO marketplace.capabilities(capability_key,actor_kind,resource_rule,description)
VALUES('admin.access.role_manage','ADMIN','ADMIN_SCOPE','Grant and revoke controlled scoped admin memberships')
ON CONFLICT DO NOTHING;

INSERT INTO marketplace.role_capabilities(role_key,capability_key)
VALUES('CONFIG_APPROVER','admin.access.role_manage')
ON CONFLICT DO NOTHING;
