-- A refused request names the field it was about (vendor-onboarding repair,
-- after the phase 11 gate). An operator creating a shop read "Something in
-- that request was not valid" for every refusal -- a category the network
-- does not take, a password the sign-in provider refused, an email it would
-- not accept -- and could not tell which. The response now carries field
-- errors with these keys; the server's own wording stays in the logs.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('validation.invalid_field', 'error', 'SHARED',
    'Field error: this field was not accepted'),
  ('validation.password_rejected', 'error', 'SHARED',
    'Field error: the password does not meet the sign-in rules'),
  ('validation.email_rejected', 'error', 'SHARED',
    'Field error: the email address was not accepted')
ON CONFLICT (locale_key) DO NOTHING;

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('validation.invalid_field', 'en', 'This field was not accepted.'),
  ('validation.invalid_field', 'hi', 'यह जानकारी स्वीकार नहीं की गई।'),
  ('validation.password_rejected', 'en',
    'Choose a stronger password: at least 8 characters, mixing upper and lower case letters, a number and a symbol, and not a common password.'),
  ('validation.password_rejected', 'hi',
    'मज़बूत पासवर्ड चुनें: कम से कम 8 अक्षर, बड़े और छोटे अक्षर, एक अंक और एक चिह्न, और कोई आम पासवर्ड नहीं।'),
  ('validation.email_rejected', 'en', 'That email address was not accepted. Check it, or use another.'),
  ('validation.email_rejected', 'hi', 'यह ईमेल पता स्वीकार नहीं किया गया। इसे जाँचें या कोई दूसरा पता दें।')
ON CONFLICT (locale_key, language_code) DO NOTHING;
