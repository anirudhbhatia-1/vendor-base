DELETE FROM marketplace.locale_translations WHERE locale_key LIKE 'customer.quote.promise.%';
DELETE FROM marketplace.locale_keys WHERE locale_key LIKE 'customer.quote.promise.%';
ALTER TABLE marketplace.checkout_quote_groups
  DROP CONSTRAINT checkout_quote_group_promise_shape,
  DROP CONSTRAINT checkout_quote_group_route_shape,
  DROP CONSTRAINT checkout_quote_group_route_source_allowed,
  DROP COLUMN arrives_after_seconds,
  DROP COLUMN ready_after_seconds,
  DROP COLUMN route_source,
  DROP COLUMN route_seconds,
  DROP COLUMN route_metres;
DROP TABLE marketplace.route_cache;
