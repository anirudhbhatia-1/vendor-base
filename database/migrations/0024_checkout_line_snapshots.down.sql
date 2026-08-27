DROP TRIGGER checkout_events_append_only ON marketplace.checkout_events;
DROP FUNCTION marketplace.protect_checkout_history();
DROP TABLE marketplace.checkout_events;
DROP TABLE marketplace.vendor_order_lines;
DROP TABLE marketplace.checkout_quote_lines;
