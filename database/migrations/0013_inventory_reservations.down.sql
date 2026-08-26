DROP TRIGGER IF EXISTS inventory_events_append_only ON marketplace.inventory_events;
DROP FUNCTION IF EXISTS marketplace.protect_inventory_history();
DROP TABLE IF EXISTS marketplace.inventory_events;
DROP TABLE IF EXISTS marketplace.inventory_reservations;
DROP TABLE IF EXISTS marketplace.inventory_items;
