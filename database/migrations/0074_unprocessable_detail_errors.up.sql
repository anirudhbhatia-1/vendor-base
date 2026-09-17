-- Two 422 refusals that carried their reason and lost it.
--
-- `InventoryUnavailableError` carries `available_quantity` and
-- `VendorPublicationIncompleteError` carries `missing_checks`. Neither
-- INVENTORY_UNAVAILABLE nor UNPROCESSABLE_ENTITY was a stable code, so both fell
-- back to BUSINESS_RULE_VIOLATION -- "That is not allowed in the current state."
-- A vendor pressing Publish was told that instead of being told which checks were
-- still outstanding, and the checklist is the whole feature.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('inventory.unavailable', 'error', 'SHARED',
    'Stable error INVENTORY_UNAVAILABLE: fewer units are available than requested'),
  ('vendor.publication_incomplete', 'error', 'VENDOR',
    'Stable error PUBLICATION_INCOMPLETE: publication is blocked by outstanding checks');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('inventory.unavailable', 'en', 'There is not enough stock left for that quantity.'),
  -- Hindi copy carried forward for native-speaker review with the error strings
  -- added in 0064, 0065, 0072 and 0073.
  ('inventory.unavailable', 'hi', 'उस मात्रा के लिए पर्याप्त स्टॉक नहीं बचा है।'),
  ('vendor.publication_incomplete', 'en',
    'This store cannot go live yet. Some readiness checks are still outstanding.'),
  ('vendor.publication_incomplete', 'hi',
    'यह स्टोर अभी लाइव नहीं हो सकता। कुछ तैयारी जाँचें अभी बाकी हैं।');
