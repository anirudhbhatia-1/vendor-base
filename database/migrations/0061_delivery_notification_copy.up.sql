-- Copy for the order notifications a customer can now actually read (MKT-11).
--
-- The inbox's sentences were written against template keys nothing emitted, so
-- every notification fell through to its own key. Matching them up added new
-- copy for the states that had no sentence at all — declined, timed out, picked
-- up, returned, and a weighed item awaiting a price decision.

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.notification.declined', 'customer', 'CUSTOMER', 'Customer copy: notification order declined'),
  ('customer.notification.timed_out', 'customer', 'CUSTOMER', 'Customer copy: notification order timed out'),
  ('customer.notification.weight_decision', 'customer', 'CUSTOMER', 'Customer copy: notification weight decision'),
  ('customer.notification.picked_up', 'customer', 'CUSTOMER', 'Customer copy: notification order picked up'),
  ('customer.notification.returned', 'customer', 'CUSTOMER', 'Customer copy: notification order returned'),
  ('customer.notification.support_opened', 'customer', 'CUSTOMER', 'Customer copy: notification support case opened'),
  ('customer.order.rate_delivery', 'customer', 'CUSTOMER', 'Customer copy: rate the delivery'),
  ('customer.order.rated_delivery', 'customer', 'CUSTOMER', 'Customer copy: delivery rating recorded')
ON CONFLICT (locale_key) DO NOTHING;

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.notification.declined', 'en', 'could not take this order. Nothing has been charged for it.'),
  ('customer.notification.timed_out', 'en', 'did not answer in time, so the order was cancelled. Nothing has been charged for it.'),
  ('customer.notification.weight_decision', 'en', 'A store weighed an item and needs you to accept the final price.'),
  ('customer.notification.picked_up', 'en', 'Your order has left the shop.'),
  ('customer.notification.returned', 'en', 'Your order could not be delivered and went back to the shop. We have opened a case and will come back to you.'),
  ('customer.notification.support_opened', 'en', 'Your support case is open.'),
  ('customer.order.rate_delivery', 'en', 'And how was the delivery?'),
  ('customer.order.rated_delivery', 'en', 'Thank you — the delivery is rated too.')
ON CONFLICT (locale_key, language_code) DO NOTHING;

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.notification.declined', 'hi', 'यह ऑर्डर नहीं ले सकी। इसके लिए कुछ भी नहीं काटा गया है।'),
  ('customer.notification.timed_out', 'hi', 'ने समय पर जवाब नहीं दिया, इसलिए ऑर्डर रद्द हो गया। इसके लिए कुछ भी नहीं काटा गया है।'),
  ('customer.notification.weight_decision', 'hi', 'एक दुकान ने सामान तौला है और आपसे आख़िरी दाम की मंज़ूरी चाहिए।'),
  ('customer.notification.picked_up', 'hi', 'आपका ऑर्डर दुकान से निकल चुका है।'),
  ('customer.notification.returned', 'hi', 'आपका ऑर्डर पहुँचाया नहीं जा सका और दुकान वापस चला गया। हमने मामला खोल दिया है और आपसे संपर्क करेंगे।'),
  ('customer.notification.support_opened', 'hi', 'आपका सहायता मामला खुल गया है।'),
  ('customer.order.rate_delivery', 'hi', 'और डिलीवरी कैसी रही?'),
  ('customer.order.rated_delivery', 'hi', 'धन्यवाद — डिलीवरी की रेटिंग भी दर्ज हो गई।')
ON CONFLICT (locale_key, language_code) DO NOTHING;
