-- The refusal a customer sees when they ask for a way of receiving an order
-- that the store does not offer.
--
-- Until now nothing refused it: the cart wrote whatever method it was given
-- and defaulted a new store group to PLATFORM_DELIVERY without asking whether
-- the store delivers, so a pickup-only shop could take a delivery order it had
-- no way to fulfil (CUS-33 says "where the vendor and zone support them").
-- FULFILMENT_METHOD_UNAVAILABLE is the stable code for that refusal; it carries
-- the modes the store does offer so the customer can pick one.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('cart.fulfilment_method_unavailable', 'error', 'CUSTOMER',
    'Stable error FULFILMENT_METHOD_UNAVAILABLE: the store does not offer the chosen way of receiving the order');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('cart.fulfilment_method_unavailable', 'en',
    'This store does not offer that option. Choose one of the ways it can get the order to you.'),
  -- Hindi copy carried forward for native-speaker review with the error strings
  -- added in 0064, 0065, 0072, 0073, 0074 and 0076.
  ('cart.fulfilment_method_unavailable', 'hi',
    'यह दुकान वह विकल्प नहीं देती। ऑर्डर पाने के उपलब्ध तरीकों में से एक चुनें।');

-- The quote records why a group could not be quoted, and the schema lists the
-- reasons it will accept. A group asking for a method the store does not offer
-- is the new one; it is blocked ahead of minimum and stock because it is the
-- one the customer can repair without changing what they are buying.
ALTER TABLE marketplace.checkout_quote_blocked_groups
  DROP CONSTRAINT checkout_quote_blocked_groups_reason_code_check,
  ADD CONSTRAINT checkout_quote_blocked_groups_reason_code_check CHECK
    (reason_code IN ('FULFILMENT_METHOD_UNAVAILABLE', 'MINIMUM_NOT_MET',
                     'INVENTORY_UNAVAILABLE', 'STORE_UNAVAILABLE'));
