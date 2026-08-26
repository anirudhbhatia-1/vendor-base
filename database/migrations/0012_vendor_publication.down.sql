DROP TRIGGER IF EXISTS vendor_publication_events_append_only
  ON marketplace.vendor_publication_events;
DROP FUNCTION IF EXISTS marketplace.protect_vendor_publication_history();
DROP TABLE IF EXISTS marketplace.vendor_publication_events;
DROP TABLE IF EXISTS marketplace.vendor_publication_cases;

DELETE FROM marketplace.role_separation_rules
WHERE first_role_key = 'VENDOR_PUBLICATION_OPERATOR'
  AND second_role_key = 'VENDOR_PUBLICATION_REVIEWER';
DELETE FROM marketplace.role_capabilities
WHERE role_key IN ('VENDOR_PUBLICATION_OPERATOR', 'VENDOR_PUBLICATION_REVIEWER');
DELETE FROM marketplace.roles
WHERE role_key IN ('VENDOR_PUBLICATION_OPERATOR', 'VENDOR_PUBLICATION_REVIEWER');
DELETE FROM marketplace.capabilities
WHERE capability_key IN
  ('admin.vendor_publication.manage', 'admin.vendor_publication.review');
