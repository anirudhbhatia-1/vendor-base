-- 11.2: an operator acts on one order through a previewed, confirmed,
-- reasoned command, and the order's history names them.
--
-- Until audit run 74 no route used admin.order.intervene: the monitor's
-- previews were sentences written in the browser, and there was no command
-- behind them. An order ended by operations could not even be recorded as
-- theirs -- the order history accepted no admin actor.
ALTER TABLE marketplace.vendor_order_events
  DROP CONSTRAINT vendor_order_events_actor_kind_check;
ALTER TABLE marketplace.vendor_order_events
  ADD CONSTRAINT vendor_order_events_actor_kind_check
    CHECK (actor_kind IN ('admin','customer','delivery_partner','system','vendor_staff'));

-- What operations may tell a customer about an order: three fixed messages,
-- never free text, each with its copy.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.notification.operations_under_review', 'customer', 'CUSTOMER', 'Customer copy: operations are looking into the order'),
  ('customer.notification.operations_delay_acknowledged', 'customer', 'CUSTOMER', 'Customer copy: operations know the order is late'),
  ('customer.notification.operations_will_contact', 'customer', 'CUSTOMER', 'Customer copy: support will contact the customer')
ON CONFLICT (locale_key) DO NOTHING;
INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.notification.operations_under_review', 'en', 'Our operations team is looking into your order and will update you here.'),
  ('customer.notification.operations_delay_acknowledged', 'en', 'We know your order is running late and are working with the store to move it along.'),
  ('customer.notification.operations_will_contact', 'en', 'Our support team will contact you about your order shortly.'),
  ('customer.notification.operations_under_review', 'hi', 'हमारी ऑपरेशंस टीम आपके ऑर्डर को देख रही है और यहीं आपको बताएगी।'),
  ('customer.notification.operations_delay_acknowledged', 'hi', 'हमें पता है कि आपके ऑर्डर में देर हो रही है; हम दुकान के साथ इसे आगे बढ़ा रहे हैं।'),
  ('customer.notification.operations_will_contact', 'hi', 'हमारी सहायता टीम जल्द ही आपके ऑर्डर के बारे में आपसे संपर्क करेगी।')
ON CONFLICT (locale_key, language_code) DO NOTHING;
