DELETE FROM marketplace.role_capabilities WHERE capability_key IN
  ('partner.application.manage','partner.earnings.read','partner.earnings.dispute',
   'admin.partner_application.review','admin.partner_earnings.resolve');
DELETE FROM marketplace.capabilities WHERE capability_key IN
  ('partner.application.manage','partner.earnings.read','partner.earnings.dispute',
   'admin.partner_application.review','admin.partner_earnings.resolve');

DROP TABLE IF EXISTS marketplace.partner_dispute_cases;
DROP TABLE IF EXISTS marketplace.partner_earnings_records;

DROP TRIGGER IF EXISTS partner_exception_events_append_only ON marketplace.partner_exception_events;
DROP FUNCTION IF EXISTS marketplace.protect_partner_exception_history();
DROP TABLE IF EXISTS marketplace.partner_exception_events;

DROP TABLE IF EXISTS marketplace.partner_offline_proofs;

DROP TRIGGER IF EXISTS partner_application_events_append_only ON marketplace.partner_application_events;
DROP FUNCTION IF EXISTS marketplace.protect_partner_application_history();
DROP TABLE IF EXISTS marketplace.partner_application_events;
DROP TABLE IF EXISTS marketplace.partner_applications;
