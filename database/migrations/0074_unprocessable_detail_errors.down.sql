DELETE FROM marketplace.locale_translations
 WHERE locale_key IN ('inventory.unavailable', 'vendor.publication_incomplete');
DELETE FROM marketplace.locale_keys
 WHERE locale_key IN ('inventory.unavailable', 'vendor.publication_incomplete');
