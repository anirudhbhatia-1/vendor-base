DROP TRIGGER IF EXISTS vendor_onboarding_events_append_only
  ON marketplace.vendor_onboarding_events;
DROP TRIGGER IF EXISTS vendor_document_reviews_append_only
  ON marketplace.vendor_document_reviews;
DROP FUNCTION IF EXISTS marketplace.protect_vendor_onboarding_history();
DROP TABLE IF EXISTS marketplace.vendor_onboarding_events;
DROP TABLE IF EXISTS marketplace.vendor_onboarding_appeals;
DROP TABLE IF EXISTS marketplace.vendor_document_reviews;
DROP TABLE IF EXISTS marketplace.vendor_verification_documents;
DROP TABLE IF EXISTS marketplace.vendor_onboarding_cases;

DELETE FROM marketplace.role_separation_rules
 WHERE first_role_key = 'VENDOR_ONBOARDING_OPERATOR'
   AND second_role_key = 'VENDOR_ONBOARDING_REVIEWER';
DELETE FROM marketplace.role_capabilities
 WHERE role_key IN ('VENDOR_ONBOARDING_OPERATOR', 'VENDOR_ONBOARDING_REVIEWER');
DELETE FROM marketplace.roles
 WHERE role_key IN ('VENDOR_ONBOARDING_OPERATOR', 'VENDOR_ONBOARDING_REVIEWER');
DELETE FROM marketplace.capabilities
 WHERE capability_key IN ('admin.vendor_onboarding.manage',
                           'admin.vendor_onboarding.review');
