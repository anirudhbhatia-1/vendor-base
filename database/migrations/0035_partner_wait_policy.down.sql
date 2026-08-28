DROP TRIGGER IF EXISTS partner_wait_earning_adjustments_append_only ON marketplace.partner_wait_earning_adjustments;
DROP TRIGGER IF EXISTS partner_wait_timer_events_append_only ON marketplace.partner_wait_timer_events;
DROP FUNCTION IF EXISTS marketplace.protect_partner_wait_history();
DROP TABLE IF EXISTS marketplace.partner_wait_earning_adjustments;
DROP TABLE IF EXISTS marketplace.partner_wait_timer_events;
DROP TABLE IF EXISTS marketplace.partner_wait_timers;
