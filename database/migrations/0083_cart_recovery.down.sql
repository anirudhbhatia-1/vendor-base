DELETE FROM marketplace.locale_translations
 WHERE locale_key IN
   ('customer.cart.group.unavailable', 'customer.cart.group.reason.store_closed',
    'customer.cart.group.reason.store_unpublished', 'customer.cart.group.reason.address_out_of_zone',
    'customer.cart.group.remove', 'customer.cart.line.stale.product_no_longer_active',
    'customer.cart.line.stale.price_withdrawn', 'customer.cart.line.stale.availability_unknown',
    'customer.cart.line.remove');
DELETE FROM marketplace.locale_keys
 WHERE locale_key IN
   ('customer.cart.group.unavailable', 'customer.cart.group.reason.store_closed',
    'customer.cart.group.reason.store_unpublished', 'customer.cart.group.reason.address_out_of_zone',
    'customer.cart.group.remove', 'customer.cart.line.stale.product_no_longer_active',
    'customer.cart.line.stale.price_withdrawn', 'customer.cart.line.stale.availability_unknown',
    'customer.cart.line.remove');

-- The cart history is append-only, so events of the two new types cannot be
-- deleted; a reversal on a database that has recorded any fails on the
-- narrower constraint, which is the honest outcome.
ALTER TABLE marketplace.cart_events
  DROP CONSTRAINT cart_event_type_allowed,
  ADD CONSTRAINT cart_event_type_allowed CHECK (event_type IN
    ('CART_CREATED', 'GROUP_ADDED', 'GROUP_INVALIDATED', 'GROUP_REMOVED',
     'LINE_ADDED', 'LINE_QUANTITY_CHANGED', 'LINE_MARKED_STALE', 'LINE_REMOVED',
     'ADDRESS_CHANGED', 'FULFILMENT_METHOD_CHANGED'));

ALTER TABLE marketplace.cart_lines
  DROP CONSTRAINT cart_line_stale_reason_when_stale,
  DROP CONSTRAINT cart_line_stale_reason_shape,
  DROP COLUMN stale_reason;
ALTER TABLE marketplace.cart_vendor_groups
  DROP CONSTRAINT cart_vendor_group_invalid_reason_when_invalid,
  DROP CONSTRAINT cart_vendor_group_invalid_reason_shape,
  DROP COLUMN invalid_reason;
