-- A stable code for "the pick list is not finished".
--
-- Reported from a live session: a vendor pressed Mark ready five times in one
-- minute and was told each time that something had changed and to refresh. Nothing
-- had changed. `markReady` refuses while any line is unresolved, and that refusal
-- -- along with the other twenty-four in the module -- arrived as a bare 409,
-- which the API reports as VERSION_CONFLICT. Refreshing cannot resolve a pick
-- line, so the advice sent the vendor round a loop with no exit.
--
-- Audience VENDOR: only the vendor console reaches this state.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('vendor.picking_incomplete', 'error', 'VENDOR',
    'Stable error PICKING_INCOMPLETE: the order still has unresolved pick lines');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('vendor.picking_incomplete', 'en',
    'Finish the pick list first. Every item needs to be marked found or missing before the order can be ready.'),
  -- Hindi copy carried forward for native-speaker review with the error strings
  -- added in 0064, 0065 and 0072.
  ('vendor.picking_incomplete', 'hi',
    'पहले पिक सूची पूरी करें। ऑर्डर तैयार होने से पहले हर वस्तु को मिली या नहीं मिली के रूप में चिह्नित करना होगा।');
