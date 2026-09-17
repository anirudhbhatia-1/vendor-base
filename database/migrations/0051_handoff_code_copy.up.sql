-- The customer's own collection and delivery codes (CUS-51, CUS-56).
--
-- Added with the codes themselves: a customer reading the app in Hindi should
-- not meet an English instruction at the one moment the wording matters, which
-- is while a stranger is standing at their door asking for a number.

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.order.otp.expires', 'customer', 'CUSTOMER', 'Customer copy: order otp expires'),
  ('customer.order.otp.hide', 'customer', 'CUSTOMER', 'Customer copy: order otp hide'),
  ('customer.order.otp.hint', 'customer', 'CUSTOMER', 'Customer copy: order otp hint'),
  ('customer.order.otp.label', 'customer', 'CUSTOMER', 'Customer copy: order otp label'),
  ('customer.order.otp.label_pickup', 'customer', 'CUSTOMER', 'Customer copy: order otp label pickup'),
  ('customer.order.otp.show', 'customer', 'CUSTOMER', 'Customer copy: order otp show'),
  ('customer.order.otp.show_pickup', 'customer', 'CUSTOMER', 'Customer copy: order otp show pickup')
ON CONFLICT (locale_key) DO NOTHING;

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.order.otp.expires', 'en', 'Valid until'),
  ('customer.order.otp.hide', 'en', 'Hide it'),
  ('customer.order.otp.hint', 'en', 'Only give it once they are with you and you have your order.'),
  ('customer.order.otp.label', 'en', 'Read this to the delivery partner'),
  ('customer.order.otp.label_pickup', 'en', 'Show this at the counter'),
  ('customer.order.otp.show', 'en', 'Show my delivery code'),
  ('customer.order.otp.show_pickup', 'en', 'Show my collection code')
ON CONFLICT (locale_key, language_code) DO NOTHING;

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.order.otp.expires', 'hi', 'इस समय तक मान्य'),
  ('customer.order.otp.hide', 'hi', 'छिपाएँ'),
  ('customer.order.otp.hint', 'hi', 'तभी बताएँ जब वे आपके सामने हों और आपका सामान आपके पास हो।'),
  ('customer.order.otp.label', 'hi', 'यह डिलीवरी पार्टनर को पढ़कर सुनाएँ'),
  ('customer.order.otp.label_pickup', 'hi', 'यह काउंटर पर दिखाएँ'),
  ('customer.order.otp.show', 'hi', 'मेरा डिलीवरी कोड दिखाएँ'),
  ('customer.order.otp.show_pickup', 'hi', 'मेरा कलेक्शन कोड दिखाएँ')
ON CONFLICT (locale_key, language_code) DO NOTHING;
