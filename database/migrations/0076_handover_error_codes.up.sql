-- Nine handover refusals that could not say what they were.
--
-- The vendor's four pickup-code outcomes (not issued, wrong, expired, exhausted)
-- all reported ORDER_STATE_CONFLICT, whose client wording is "That step is not
-- available yet. Check the job for what still has to happen first." A vendor
-- typing a guessed code got the same sentence as one whose customer had not
-- opened theirs yet. The partner's three delivery-code outcomes and the
-- customer-code-already-live refusal were declared at their controllers but
-- never registered as stable codes, so the exception filter discarded them.
-- PARTNER_NOT_PRESENT is new with the handover gate in 0075.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('orders.pickup_otp_missing', 'error', 'VENDOR',
    'Stable error PICKUP_OTP_MISSING: no collection code has been issued for the order yet'),
  ('orders.pickup_otp_mismatch', 'error', 'VENDOR',
    'Stable error PICKUP_OTP_MISMATCH: the code entered does not match the live code'),
  ('orders.pickup_otp_expired', 'error', 'VENDOR',
    'Stable error PICKUP_OTP_EXPIRED: the live collection code has expired'),
  ('orders.pickup_otp_exhausted', 'error', 'VENDOR',
    'Stable error PICKUP_OTP_EXHAUSTED: too many wrong attempts; the code must be re-issued'),
  ('orders.customer_otp_active', 'error', 'VENDOR',
    'Stable error CUSTOMER_OTP_ACTIVE: the collector already holds a live code, so no fallback is issued'),
  ('orders.partner_not_present', 'error', 'VENDOR',
    'Stable error PARTNER_NOT_PRESENT: a platform delivery is handed over only once its partner has arrived'),
  ('delivery.otp_mismatch', 'error', 'PARTNER',
    'Stable error DELIVERY_OTP_MISMATCH: the delivery code entered does not match'),
  ('delivery.otp_expired', 'error', 'PARTNER',
    'Stable error DELIVERY_OTP_EXPIRED: the customer''s delivery code has expired'),
  ('delivery.otp_exhausted', 'error', 'PARTNER',
    'Stable error DELIVERY_OTP_EXHAUSTED: too many wrong delivery-code attempts');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('orders.pickup_otp_missing', 'en',
    'No collection code has been issued for this order yet. Ask the person collecting to open theirs.'),
  ('orders.pickup_otp_mismatch', 'en', 'That code does not match. Check it and try again.'),
  ('orders.pickup_otp_expired', 'en',
    'That collection code has expired. Ask the person collecting to open a fresh one.'),
  ('orders.pickup_otp_exhausted', 'en',
    'Too many wrong attempts. A fresh collection code has to be issued before trying again.'),
  ('orders.customer_otp_active', 'en',
    'They already have a live collection code. Ask them to read it from their screen.'),
  ('orders.partner_not_present', 'en',
    'Hand this order over when the delivery partner is at your counter.'),
  ('delivery.otp_mismatch', 'en', 'That delivery code does not match. Check it and try again.'),
  ('delivery.otp_expired', 'en',
    'That delivery code has expired. Ask the customer to open a fresh one.'),
  ('delivery.otp_exhausted', 'en',
    'Too many wrong attempts. Ask the customer to open a fresh delivery code.'),
  -- Hindi copy carried forward for native-speaker review with the error strings
  -- added in 0064, 0065, 0072, 0073 and 0074.
  ('orders.pickup_otp_missing', 'hi',
    'इस ऑर्डर के लिए अभी तक कोई कलेक्शन कोड जारी नहीं हुआ है। लेने वाले से अपना कोड खोलने को कहें।'),
  ('orders.pickup_otp_mismatch', 'hi', 'यह कोड मेल नहीं खाता। जाँच कर फिर से कोशिश करें।'),
  ('orders.pickup_otp_expired', 'hi',
    'यह कलेक्शन कोड समाप्त हो गया है। लेने वाले से नया कोड खोलने को कहें।'),
  ('orders.pickup_otp_exhausted', 'hi',
    'बहुत अधिक गलत प्रयास। फिर से कोशिश करने से पहले नया कलेक्शन कोड जारी करना होगा।'),
  ('orders.customer_otp_active', 'hi',
    'उनके पास पहले से एक सक्रिय कलेक्शन कोड है। उनसे अपनी स्क्रीन से पढ़ने को कहें।'),
  ('orders.partner_not_present', 'hi',
    'जब डिलीवरी पार्टनर आपके काउंटर पर हो, तब यह ऑर्डर सौंपें।'),
  ('delivery.otp_mismatch', 'hi', 'यह डिलीवरी कोड मेल नहीं खाता। जाँच कर फिर से कोशिश करें।'),
  ('delivery.otp_expired', 'hi',
    'यह डिलीवरी कोड समाप्त हो गया है। ग्राहक से नया कोड खोलने को कहें।'),
  ('delivery.otp_exhausted', 'hi',
    'बहुत अधिक गलत प्रयास। ग्राहक से नया डिलीवरी कोड खोलने को कहें।');
