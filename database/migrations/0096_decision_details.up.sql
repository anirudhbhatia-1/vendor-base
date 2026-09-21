-- Phase 8.4: what a customer decision carries, and where its money goes.
--
-- The order history is where the customer's notifications come from; a
-- proposal's event did not name its decision, so the notice could say only
-- "a replacement item" -- no old item, no new one, no amount, no deadline.
ALTER TABLE marketplace.vendor_order_events
  ADD COLUMN decision_id uuid
    REFERENCES marketplace.vendor_order_customer_decisions (decision_id) ON DELETE RESTRICT;

-- The lines that are not in the bag as ordered -- missing, refused, short --
-- reduce what the customer is charged before capture, in one adjustment per
-- order when the picks become final at ready (implementation.md 6.2.4).
ALTER TABLE marketplace.payment_authorization_adjustments
  DROP CONSTRAINT payment_authorization_adjustment_kind_allowed,
  ADD CONSTRAINT payment_authorization_adjustment_kind_allowed
    CHECK (adjustment_kind IN ('CUSTOMER_DECISION', 'VENDOR_ORDER_ENDED', 'LINES_NOT_SUPPLIED'));

CREATE UNIQUE INDEX payment_authorization_adjustment_lines_unique
  ON marketplace.payment_authorization_adjustments (vendor_order_id)
  WHERE adjustment_kind = 'LINES_NOT_SUPPLIED';

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.decisions.ordered', 'customer', 'CUSTOMER', 'Decision card: label before the item as ordered'),
  ('customer.decisions.offered', 'customer', 'CUSTOMER', 'Decision card: label before what the shop offers instead'),
  ('customer.decisions.more', 'customer', 'CUSTOMER', 'Decision card: the extra amount if approved'),
  ('customer.decisions.less', 'customer', 'CUSTOMER', 'Decision card: the amount not charged if approved'),
  ('customer.decisions.same_price', 'customer', 'CUSTOMER', 'Decision card: no change in amount'),
  ('customer.notification.substitution_applied', 'customer', 'CUSTOMER', 'Inbox: the shop replaced an item under the customer''s own rule'),
  ('customer.notification.weight_applied', 'customer', 'CUSTOMER', 'Inbox: the shop weighed an item lighter; the difference is not charged');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.decisions.ordered', 'en', 'You ordered'),
  ('customer.decisions.offered', 'en', 'The shop offers'),
  ('customer.decisions.more', 'en', 'more than you authorised, added if you approve'),
  ('customer.decisions.less', 'en', 'less; the difference is not charged'),
  ('customer.decisions.same_price', 'en', 'at the same price'),
  ('customer.notification.substitution_applied', 'en', 'The shop replaced an item with a close match, as you allowed. You are not charged more.'),
  ('customer.notification.weight_applied', 'en', 'An item weighed lighter than ordered. You pay only for what you get.'),
  -- Hindi copy carried forward for native-speaker review with 0048.
  ('customer.decisions.ordered', 'hi', 'आपने मँगाया'),
  ('customer.decisions.offered', 'hi', 'दुकान दे रही है'),
  ('customer.decisions.more', 'hi', 'आपकी अनुमति से अधिक; स्वीकार करने पर जुड़ेगा'),
  ('customer.decisions.less', 'hi', 'कम; अंतर नहीं लिया जाएगा'),
  ('customer.decisions.same_price', 'hi', 'उसी कीमत पर'),
  ('customer.notification.substitution_applied', 'hi', 'दुकान ने आपकी अनुमति के अनुसार एक वस्तु को मिलते-जुलते विकल्प से बदल दिया। आपसे अधिक नहीं लिया जाएगा।'),
  ('customer.notification.weight_applied', 'hi', 'एक वस्तु का वज़न मँगाए से कम निकला। आप केवल उतना ही चुकाते हैं जितना मिला।');
