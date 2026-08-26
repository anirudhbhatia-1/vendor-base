DELETE FROM marketplace.role_capabilities WHERE capability_key = 'customer.cart.manage';
DELETE FROM marketplace.capabilities WHERE capability_key = 'customer.cart.manage';
DROP TRIGGER IF EXISTS cart_events_append_only ON marketplace.cart_events;
DROP FUNCTION IF EXISTS marketplace.protect_cart_history();
DROP TABLE IF EXISTS marketplace.cart_events;
DROP TABLE IF EXISTS marketplace.cart_lines;
DROP TABLE IF EXISTS marketplace.cart_vendor_groups;
DROP TABLE IF EXISTS marketplace.carts;
