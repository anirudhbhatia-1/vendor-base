-- Phase 8.3: the ordered lines are immutable, and two refusals a picker can act on.
--
-- The order's lines are the snapshot the customer paid against. Nothing
-- updated them, but nothing forbade it either; the picks table is where the
-- shop's answers go. The same guard the order history has.
CREATE FUNCTION marketplace.protect_vendor_order_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'vendor order lines are an immutable snapshot' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER vendor_order_lines_immutable
BEFORE UPDATE OR DELETE ON marketplace.vendor_order_lines
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_vendor_order_lines();

-- Audience VENDOR: only the vendor console reaches these.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('vendor.substitution_not_allowed', 'error', 'VENDOR',
    'Stable error SUBSTITUTION_NOT_ALLOWED: the customer chose refund-never-replace for this line'),
  ('vendor.line_awaiting_customer', 'error', 'VENDOR',
    'Stable error LINE_AWAITING_CUSTOMER: a proposal on this line is with the customer or was approved');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('vendor.substitution_not_allowed', 'en',
    'The customer asked for no replacements on this item. Mark it not available and they are refunded for it.'),
  ('vendor.line_awaiting_customer', 'en',
    'The customer is deciding on this item, or has already answered. It cannot be changed from here.'),
  -- Hindi copy carried forward for native-speaker review with 0073.
  ('vendor.substitution_not_allowed', 'hi',
    'ग्राहक ने इस वस्तु के लिए कोई विकल्प नहीं चाहा। इसे उपलब्ध नहीं के रूप में चिह्नित करें; उन्हें इसकी राशि लौटा दी जाएगी।'),
  ('vendor.line_awaiting_customer', 'hi',
    'ग्राहक इस वस्तु पर निर्णय ले रहे हैं, या पहले ही उत्तर दे चुके हैं। इसे यहाँ से बदला नहीं जा सकता।');
