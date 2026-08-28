DELETE FROM marketplace.role_capabilities WHERE capability_key IN ('partner.availability.manage','admin.delivery.partner_dispatch');
DELETE FROM marketplace.capabilities WHERE capability_key IN ('partner.availability.manage','admin.delivery.partner_dispatch');
DROP TRIGGER IF EXISTS partner_availability_events_append_only ON marketplace.partner_availability_events;
DROP FUNCTION IF EXISTS marketplace.protect_partner_availability_events();
DROP TABLE IF EXISTS marketplace.partner_availability_events;
DROP TABLE IF EXISTS marketplace.partner_availability;
