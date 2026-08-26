DELETE FROM marketplace.role_capabilities
 WHERE capability_key IN ('vendor.staff.manage', 'vendor.settings.manage');
DELETE FROM marketplace.capabilities
 WHERE capability_key IN ('vendor.staff.manage', 'vendor.settings.manage');
DROP TRIGGER IF EXISTS vendor_staff_events_append_only ON marketplace.vendor_staff_events;
DROP FUNCTION IF EXISTS marketplace.protect_vendor_staff_history();
DROP TABLE IF EXISTS marketplace.vendor_staff_events;
