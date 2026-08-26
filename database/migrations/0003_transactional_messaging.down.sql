DROP TABLE IF EXISTS marketplace.outbox_recoveries;
DROP TABLE IF EXISTS marketplace.inbox_receipts;
DROP TABLE IF EXISTS marketplace.outbox_events;
DROP FUNCTION IF EXISTS marketplace.protect_messaging_history();
DROP FUNCTION IF EXISTS marketplace.protect_outbox_event_content();
