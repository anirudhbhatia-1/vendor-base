DELETE FROM marketplace.locale_translations
  WHERE locale_key IN ('customer.order.promise.collect', 'customer.order.promise.arrives');
DELETE FROM marketplace.locale_keys
  WHERE locale_key IN ('customer.order.promise.collect', 'customer.order.promise.arrives');
ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_handling_flags_allowed,
  DROP COLUMN handling_flags;
