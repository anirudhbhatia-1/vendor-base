DELETE FROM marketplace.role_capabilities WHERE capability_key = 'customer.address.manage';
DELETE FROM marketplace.capabilities WHERE capability_key = 'customer.address.manage';
DROP TRIGGER IF EXISTS customer_address_events_append_only
  ON marketplace.customer_address_events;
DROP FUNCTION IF EXISTS marketplace.protect_customer_address_history();
DROP TABLE IF EXISTS marketplace.customer_address_events;
DROP TABLE IF EXISTS marketplace.customer_addresses;
