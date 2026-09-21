-- Phase 8.7: the receipt says what was charged, and a case names its item.
--
-- A support case was opened against the whole vendor order; the customer
-- could not say which item was missing, damaged or wrong, and the shop and
-- the operations queue could not read it. The line is the smallest object
-- a case can be about, so a case may name one.
ALTER TABLE marketplace.support_cases
  ADD COLUMN vendor_order_line_id uuid
    REFERENCES marketplace.vendor_order_lines (vendor_order_line_id) ON DELETE RESTRICT;

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.receipt.ordered', 'customer', 'CUSTOMER', 'Receipt: heading over the ordered lines'),
  ('customer.receipt.charged', 'customer', 'CUSTOMER', 'Receipt: the amount actually charged'),
  ('customer.receipt.not_supplied', 'customer', 'CUSTOMER', 'Receipt: a line that was not in the bag'),
  ('customer.receipt.replaced_with', 'customer', 'CUSTOMER', 'Receipt: a line replaced, before the replacement'),
  ('customer.receipt.adjustment.lines', 'customer', 'CUSTOMER', 'Receipt: adjustment for lines not supplied'),
  ('customer.receipt.adjustment.decision', 'customer', 'CUSTOMER', 'Receipt: adjustment from a change you approved or your rule allowed'),
  ('customer.receipt.adjustment.ended', 'customer', 'CUSTOMER', 'Receipt: adjustment because the order ended before it was supplied'),
  ('customer.support.item', 'customer', 'CUSTOMER', 'Support: which item the case is about'),
  ('customer.support.item.any', 'customer', 'CUSTOMER', 'Support: the case is about the whole order');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.receipt.ordered', 'en', 'You ordered'),
  ('customer.receipt.charged', 'en', 'Charged'),
  ('customer.receipt.not_supplied', 'en', 'not supplied, not charged'),
  ('customer.receipt.replaced_with', 'en', 'replaced with'),
  ('customer.receipt.adjustment.lines', 'en', 'Items not in the bag'),
  ('customer.receipt.adjustment.decision', 'en', 'Change you approved or allowed'),
  ('customer.receipt.adjustment.ended', 'en', 'Order ended before it was supplied'),
  ('customer.support.item', 'en', 'Which item?'),
  ('customer.support.item.any', 'en', 'The whole order'),
  -- Hindi copy carried forward for native-speaker review with 0048.
  ('customer.receipt.ordered', 'hi', 'आपने मँगाया'),
  ('customer.receipt.charged', 'hi', 'लिया गया'),
  ('customer.receipt.not_supplied', 'hi', 'नहीं दिया गया, नहीं लिया गया'),
  ('customer.receipt.replaced_with', 'hi', 'इसके बदले'),
  ('customer.receipt.adjustment.lines', 'hi', 'थैले में न आई वस्तुएँ'),
  ('customer.receipt.adjustment.decision', 'hi', 'आपकी स्वीकृत या अनुमत बदलाव'),
  ('customer.receipt.adjustment.ended', 'hi', 'ऑर्डर देने से पहले समाप्त हुआ'),
  ('customer.support.item', 'hi', 'कौन सी वस्तु?'),
  ('customer.support.item.any', 'hi', 'पूरा ऑर्डर');
