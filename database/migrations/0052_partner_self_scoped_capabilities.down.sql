DELETE FROM marketplace.role_capabilities
 WHERE capability_key IN ('partner.field.read', 'partner.standing.read');

DELETE FROM marketplace.capabilities
 WHERE capability_key IN ('partner.field.read', 'partner.standing.read');
