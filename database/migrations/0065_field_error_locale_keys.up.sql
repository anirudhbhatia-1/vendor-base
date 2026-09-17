-- Migration 0064 registered the eleven stable error codes. Field errors carry their
-- own message keys, and these two were unregistered for the same reason: they were
-- inline string literals nothing could enumerate. They are now declared as
-- FIELD_ERROR_MESSAGE_KEYS in packages/domain-types/src/errors.ts, and the launch
-- readiness verifier checks them alongside the stable codes.
--
-- A malformed x-request-id or traceparent already returns 400 with these keys, so a
-- client resolving one got nothing back.

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('validation.invalid_request_id', 'error', 'SHARED',
    'Field error when the x-request-id header is not a valid identifier'),
  ('validation.invalid_traceparent', 'error', 'SHARED',
    'Field error when the traceparent header is not valid W3C trace context')
ON CONFLICT (locale_key) DO NOTHING;

-- Copy stays plain: a caller sending a bad header is usually another program, but the
-- string can still reach a person through a support case. Hindi follows the register
-- migration 0033 established and needs a native-speaker review at the 12.3 gate.
INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('validation.invalid_request_id', 'en', 'The request reference was not valid.'),
  ('validation.invalid_request_id', 'hi', 'अनुरोध संदर्भ मान्य नहीं था।'),
  ('validation.invalid_traceparent', 'en', 'The request trace information was not valid.'),
  ('validation.invalid_traceparent', 'hi', 'अनुरोध ट्रेस जानकारी मान्य नहीं थी।')
ON CONFLICT (locale_key, language_code) DO NOTHING;
