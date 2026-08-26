DROP TRIGGER IF EXISTS vendor_network_events_append_only ON marketplace.vendor_network_events;
DROP FUNCTION IF EXISTS marketplace.protect_vendor_network_history();
DROP TABLE IF EXISTS marketplace.vendor_network_events;
DROP TABLE IF EXISTS marketplace.vendor_location_fulfilment_modes;
DROP TABLE IF EXISTS marketplace.vendor_service_zones;
DROP TABLE IF EXISTS marketplace.vendor_location_temporary_closures;
DROP TABLE IF EXISTS marketplace.vendor_location_calendar_exceptions;
DROP TRIGGER IF EXISTS operating_hours_no_overlap
  ON marketplace.vendor_location_operating_hours;
DROP FUNCTION IF EXISTS marketplace.prevent_operating_hour_overlap();
DROP TABLE IF EXISTS marketplace.vendor_location_operating_hours;
ALTER TABLE marketplace.staff_memberships
  DROP CONSTRAINT IF EXISTS staff_membership_vendor_location_fk;
DROP TABLE IF EXISTS marketplace.vendor_locations;
DROP TABLE IF EXISTS marketplace.vendors;
