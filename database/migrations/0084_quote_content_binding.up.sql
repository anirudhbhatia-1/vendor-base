-- Phase 7.3: a quote is bound to what the cart contains, and says so.
--
-- The quote digest was a hash over the cart *and the stock on the shelf*, so
-- the first quote's own hold changed the digest of any retry and the replay
-- never matched; a shortcut that returned "any live quote for this cart"
-- covered for it, and returned a quote that no longer matched the cart once
-- the customer changed the basket. The digest is now over the content alone
-- (customer, cart, address, each group's method and tip, each line's variant,
-- quantity, price and catalogue versions), so a retry replays and a change
-- re-quotes. Two quotes may legitimately share a content digest once the
-- earlier one has lapsed, so uniqueness holds among live quotes only.
ALTER TABLE marketplace.checkout_quotes
  DROP CONSTRAINT checkout_quotes_quote_digest_key;
CREATE UNIQUE INDEX one_live_quote_per_content
  ON marketplace.checkout_quotes (quote_digest)
  WHERE lifecycle_state = 'ACTIVE';

-- A group with a line the store can no longer supply -- product withdrawn, no
-- current price, no stock record -- used to be quoted without that line, so
-- the basket said two items and the order had one. It is blocked with its
-- own reason, ahead of minimum and stock, because the customer repairs it by
-- removing the line.
ALTER TABLE marketplace.checkout_quote_blocked_groups
  DROP CONSTRAINT checkout_quote_blocked_groups_reason_code_check,
  ADD CONSTRAINT checkout_quote_blocked_groups_reason_code_check CHECK
    (reason_code IN ('STORE_UNAVAILABLE', 'FULFILMENT_METHOD_UNAVAILABLE', 'LINE_UNAVAILABLE',
                     'MINIMUM_NOT_MET', 'INVENTORY_UNAVAILABLE'));

-- What the checkout says about a blocked group, by reason. It used to print
-- the code in lower case.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.quote.blocked.store_unavailable', 'customer', 'CUSTOMER', 'Customer copy: quote group blocked, store unavailable'),
  ('customer.quote.blocked.fulfilment_method_unavailable', 'customer', 'CUSTOMER', 'Customer copy: quote group blocked, method no longer offered'),
  ('customer.quote.blocked.line_unavailable', 'customer', 'CUSTOMER', 'Customer copy: quote group blocked, a line cannot be supplied'),
  ('customer.quote.blocked.minimum_not_met', 'customer', 'CUSTOMER', 'Customer copy: quote group blocked, under minimum'),
  ('customer.quote.blocked.inventory_unavailable', 'customer', 'CUSTOMER', 'Customer copy: quote group blocked, not enough stock'),
  ('customer.quote.blocked.other', 'customer', 'CUSTOMER', 'Customer copy: quote group blocked, other reason');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.quote.blocked.store_unavailable', 'en', 'The store cannot take orders right now, or does not deliver to this address.'),
  ('customer.quote.blocked.fulfilment_method_unavailable', 'en', 'The store no longer offers the way you chose to receive this order. Pick another in your basket.'),
  ('customer.quote.blocked.line_unavailable', 'en', 'The store can no longer supply an item in this group. Recheck your basket and remove it.'),
  ('customer.quote.blocked.minimum_not_met', 'en', 'This group is under the store’s minimum order. Add a little more.'),
  ('customer.quote.blocked.inventory_unavailable', 'en', 'The store does not have enough of something in this group. Lower the quantity or remove it.'),
  ('customer.quote.blocked.other', 'en', 'This store cannot take this order right now.'),
  -- Hindi copy carried forward for native-speaker review with the customer
  -- strings added in 0048.
  ('customer.quote.blocked.store_unavailable', 'hi', 'दुकान अभी ऑर्डर नहीं ले सकती, या इस पते पर डिलीवरी नहीं करती।'),
  ('customer.quote.blocked.fulfilment_method_unavailable', 'hi', 'दुकान अब ऑर्डर पाने का आपका चुना हुआ तरीका नहीं देती। टोकरी में दूसरा चुनें।'),
  ('customer.quote.blocked.line_unavailable', 'hi', 'दुकान अब इस समूह की एक चीज़ नहीं दे सकती। टोकरी दोबारा जाँचें और उसे हटाएँ।'),
  ('customer.quote.blocked.minimum_not_met', 'hi', 'यह समूह दुकान के न्यूनतम ऑर्डर से कम है। थोड़ा और जोड़ें।'),
  ('customer.quote.blocked.inventory_unavailable', 'hi', 'दुकान के पास इस समूह की किसी चीज़ का पर्याप्त स्टॉक नहीं है। मात्रा घटाएँ या उसे हटाएँ।'),
  ('customer.quote.blocked.other', 'hi', 'यह दुकान अभी यह ऑर्डर नहीं ले सकती।');
