DELETE FROM marketplace.locale_translations
 WHERE locale_key IN ('customer.product.freshness', 'customer.product.freshness.fresh',
                      'customer.product.freshness.stale', 'customer.product.freshness.expired',
                      'customer.product.weight.variance');
DELETE FROM marketplace.locale_keys
 WHERE locale_key IN ('customer.product.freshness', 'customer.product.freshness.fresh',
                      'customer.product.freshness.stale', 'customer.product.freshness.expired',
                      'customer.product.weight.variance');
