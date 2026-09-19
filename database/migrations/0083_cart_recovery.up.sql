-- Phase 6.7: cart validation *and recovery*.
--
-- Revalidation marked a group INVALID and a line STALE and could never undo
-- either: a group whose store had reopened, or whose customer had changed to
-- an address the store covers, stayed INVALID forever and silently dropped
-- out of the quote. Nothing recorded *why* a group or line had failed, so a
-- basket could not say so either. The reason now lives on the row, and two
-- event types record the way back.
ALTER TABLE marketplace.cart_vendor_groups
  ADD COLUMN invalid_reason text;
UPDATE marketplace.cart_vendor_groups
   SET invalid_reason = 'REVALIDATION_REQUIRED'
 WHERE lifecycle_state = 'INVALID';
ALTER TABLE marketplace.cart_vendor_groups
  ADD CONSTRAINT cart_vendor_group_invalid_reason_shape
    CHECK (invalid_reason IS NULL OR invalid_reason ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  ADD CONSTRAINT cart_vendor_group_invalid_reason_when_invalid
    CHECK ((lifecycle_state = 'INVALID') = (invalid_reason IS NOT NULL));

ALTER TABLE marketplace.cart_lines
  ADD COLUMN stale_reason text;
UPDATE marketplace.cart_lines
   SET stale_reason = 'PRODUCT_NO_LONGER_ACTIVE'
 WHERE lifecycle_state = 'STALE';
ALTER TABLE marketplace.cart_lines
  ADD CONSTRAINT cart_line_stale_reason_shape
    CHECK (stale_reason IS NULL OR stale_reason ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  ADD CONSTRAINT cart_line_stale_reason_when_stale
    CHECK ((lifecycle_state = 'STALE') = (stale_reason IS NOT NULL));

ALTER TABLE marketplace.cart_events
  DROP CONSTRAINT cart_event_type_allowed,
  ADD CONSTRAINT cart_event_type_allowed CHECK (event_type IN
    ('CART_CREATED', 'GROUP_ADDED', 'GROUP_INVALIDATED', 'GROUP_REVALIDATED', 'GROUP_REMOVED',
     'LINE_ADDED', 'LINE_QUANTITY_CHANGED', 'LINE_MARKED_STALE', 'LINE_REVIVED', 'LINE_REMOVED',
     'ADDRESS_CHANGED', 'FULFILMENT_METHOD_CHANGED'));

-- What the basket says about a store or a line it cannot order from.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.cart.group.unavailable', 'customer', 'CUSTOMER', 'Customer copy: basket group cannot be ordered'),
  ('customer.cart.group.reason.store_closed', 'customer', 'CUSTOMER', 'Customer copy: basket group reason, store closed'),
  ('customer.cart.group.reason.store_unpublished', 'customer', 'CUSTOMER', 'Customer copy: basket group reason, store no longer listed'),
  ('customer.cart.group.reason.address_out_of_zone', 'customer', 'CUSTOMER', 'Customer copy: basket group reason, address outside the store zone'),
  ('customer.cart.group.remove', 'customer', 'CUSTOMER', 'Customer copy: remove a store from the basket'),
  ('customer.cart.line.stale.product_no_longer_active', 'customer', 'CUSTOMER', 'Customer copy: basket line reason, product withdrawn'),
  ('customer.cart.line.stale.price_withdrawn', 'customer', 'CUSTOMER', 'Customer copy: basket line reason, no current price'),
  ('customer.cart.line.stale.availability_unknown', 'customer', 'CUSTOMER', 'Customer copy: basket line reason, no stock record'),
  ('customer.cart.line.remove', 'customer', 'CUSTOMER', 'Customer copy: remove a basket line');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.cart.group.unavailable', 'en', 'This store cannot take this order right now'),
  ('customer.cart.group.reason.store_closed', 'en', 'The store is closed. Recheck later, or remove it from your basket.'),
  ('customer.cart.group.reason.store_unpublished', 'en', 'The store is no longer listed. Remove it from your basket.'),
  ('customer.cart.group.reason.address_out_of_zone', 'en',
    'The store does not deliver to your current address. Change the address, or remove the store.'),
  ('customer.cart.group.remove', 'en', 'Remove this store'),
  ('customer.cart.line.stale.product_no_longer_active', 'en', 'No longer sold by this store.'),
  ('customer.cart.line.stale.price_withdrawn', 'en', 'This store has not set a price for it.'),
  ('customer.cart.line.stale.availability_unknown', 'en', 'The store has not confirmed whether it has this.'),
  ('customer.cart.line.remove', 'en', 'Remove'),
  -- Hindi copy carried forward for native-speaker review with the customer
  -- strings added in 0048.
  ('customer.cart.group.unavailable', 'hi', 'यह दुकान अभी यह ऑर्डर नहीं ले सकती'),
  ('customer.cart.group.reason.store_closed', 'hi', 'दुकान बंद है। बाद में दोबारा जाँचें, या इसे अपनी टोकरी से हटाएँ।'),
  ('customer.cart.group.reason.store_unpublished', 'hi', 'दुकान अब सूची में नहीं है। इसे अपनी टोकरी से हटाएँ।'),
  ('customer.cart.group.reason.address_out_of_zone', 'hi',
    'दुकान आपके वर्तमान पते पर डिलीवरी नहीं करती। पता बदलें, या दुकान हटाएँ।'),
  ('customer.cart.group.remove', 'hi', 'यह दुकान हटाएँ'),
  ('customer.cart.line.stale.product_no_longer_active', 'hi', 'यह दुकान अब इसे नहीं बेचती।'),
  ('customer.cart.line.stale.price_withdrawn', 'hi', 'दुकान ने इसकी कीमत तय नहीं की है।'),
  ('customer.cart.line.stale.availability_unknown', 'hi', 'दुकान ने पुष्टि नहीं की है कि यह उपलब्ध है या नहीं।'),
  ('customer.cart.line.remove', 'hi', 'हटाएँ');
