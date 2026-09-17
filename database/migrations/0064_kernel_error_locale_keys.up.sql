-- The eleven stable error codes in `packages/domain-types/src/errors.ts` each carry a
-- `message_key`, and none of them was registered. Every other user-facing string is
-- registered and translated into both languages -- 324 keys, 324 en, 324 hi, no gaps --
-- so these were the only keys a client could ask for and not resolve. A translator
-- cannot supply text for a key that does not exist, so this is registration, not copy
-- that was merely missing.
--
-- Audience is SHARED: these are kernel errors any of the four roles can receive.

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('common.invalid_argument', 'error', 'SHARED',
    'Stable error INVALID_ARGUMENT: the request failed validation'),
  ('auth.unauthenticated', 'error', 'SHARED',
    'Stable error UNAUTHENTICATED: no valid session was presented'),
  ('auth.forbidden', 'error', 'SHARED',
    'Stable error FORBIDDEN: the actor lacks the capability for this resource'),
  ('common.resource_not_found', 'error', 'SHARED',
    'Stable error RESOURCE_NOT_FOUND: the addressed resource does not exist'),
  ('orders.state_conflict', 'error', 'SHARED',
    'Stable error STATE_CONFLICT: the order is not in a state that allows this action'),
  ('common.version_conflict', 'error', 'SHARED',
    'Stable error VERSION_CONFLICT: the record changed since it was read'),
  ('common.idempotency_key_reused', 'error', 'SHARED',
    'Stable error IDEMPOTENCY_KEY_REUSED: the key was reused with a different body'),
  ('common.business_rule_violation', 'error', 'SHARED',
    'Stable error BUSINESS_RULE_VIOLATION: an approved policy refused the request'),
  ('common.rate_limited', 'error', 'SHARED',
    'Stable error RATE_LIMITED: too many requests; retryable'),
  ('common.service_unavailable', 'error', 'SHARED',
    'Stable error SERVICE_UNAVAILABLE: a dependency is unavailable; retryable'),
  ('common.internal_error', 'error', 'SHARED',
    'Stable error INTERNAL_ERROR: an unexpected failure the caller cannot act on')
ON CONFLICT (locale_key) DO NOTHING;

-- Copy is deliberately plain and non-technical: it reaches customers, vendors,
-- partners and admins alike. The Hindi wording follows the register already used by
-- migration 0033 and needs a native-speaker review at the phase 12.3 localization gate.
INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('common.invalid_argument', 'en', 'Some of the details are not valid. Please check and try again.'),
  ('common.invalid_argument', 'hi', 'कुछ विवरण मान्य नहीं हैं। कृपया जाँचें और पुनः प्रयास करें।'),
  ('auth.unauthenticated', 'en', 'Please sign in to continue.'),
  ('auth.unauthenticated', 'hi', 'जारी रखने के लिए कृपया साइन इन करें।'),
  ('auth.forbidden', 'en', 'You do not have permission to do this.'),
  ('auth.forbidden', 'hi', 'आपके पास यह करने की अनुमति नहीं है।'),
  ('common.resource_not_found', 'en', 'We could not find what you asked for.'),
  ('common.resource_not_found', 'hi', 'आपने जो माँगा वह हमें नहीं मिला।'),
  ('orders.state_conflict', 'en', 'This order has already moved on. Refresh to see its current state.'),
  ('orders.state_conflict', 'hi', 'यह ऑर्डर आगे बढ़ चुका है। मौजूदा स्थिति देखने के लिए ताज़ा करें।'),
  ('common.version_conflict', 'en', 'Someone else changed this first. Refresh and try again.'),
  ('common.version_conflict', 'hi', 'किसी और ने इसे पहले बदल दिया। ताज़ा करें और पुनः प्रयास करें।'),
  ('common.idempotency_key_reused', 'en', 'This request was already submitted with different details.'),
  ('common.idempotency_key_reused', 'hi', 'यह अनुरोध पहले ही अलग विवरण के साथ भेजा जा चुका है।'),
  ('common.business_rule_violation', 'en', 'This is not allowed right now.'),
  ('common.business_rule_violation', 'hi', 'अभी इसकी अनुमति नहीं है।'),
  ('common.rate_limited', 'en', 'Too many attempts. Please wait a moment and try again.'),
  ('common.rate_limited', 'hi', 'बहुत अधिक प्रयास। कृपया थोड़ा रुककर पुनः प्रयास करें।'),
  ('common.service_unavailable', 'en', 'This is temporarily unavailable. Please try again shortly.'),
  ('common.service_unavailable', 'hi', 'यह अस्थायी रूप से अनुपलब्ध है। कृपया थोड़ी देर में पुनः प्रयास करें।'),
  ('common.internal_error', 'en', 'Something went wrong on our side. Please try again.'),
  ('common.internal_error', 'hi', 'हमारी ओर से कुछ गड़बड़ हुई। कृपया पुनः प्रयास करें।')
ON CONFLICT (locale_key, language_code) DO NOTHING;
