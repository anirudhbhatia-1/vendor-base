DELETE FROM marketplace.locale_translations
  WHERE locale_key IN ('vendor.substitution_not_allowed', 'vendor.line_awaiting_customer');
DELETE FROM marketplace.locale_keys
  WHERE locale_key IN ('vendor.substitution_not_allowed', 'vendor.line_awaiting_customer');
DROP TRIGGER vendor_order_lines_immutable ON marketplace.vendor_order_lines;
DROP FUNCTION marketplace.protect_vendor_order_lines();
