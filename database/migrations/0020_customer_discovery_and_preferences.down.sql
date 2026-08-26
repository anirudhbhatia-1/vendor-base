DELETE FROM marketplace.role_capabilities WHERE capability_key = 'customer.discovery.use';
DELETE FROM marketplace.capabilities WHERE capability_key = 'customer.discovery.use';
DROP TRIGGER IF EXISTS customer_discovery_events_append_only
  ON marketplace.customer_discovery_events;
DROP FUNCTION IF EXISTS marketplace.protect_customer_discovery_history();
DROP TABLE IF EXISTS marketplace.customer_discovery_events;
DROP TABLE IF EXISTS marketplace.customer_recent_searches;
DROP TABLE IF EXISTS marketplace.customer_shop_requests;
DROP TABLE IF EXISTS marketplace.customer_preferred_store;
DROP TABLE IF EXISTS marketplace.customer_favourite_stores;
