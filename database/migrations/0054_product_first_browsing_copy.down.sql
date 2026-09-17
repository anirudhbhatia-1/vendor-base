DELETE FROM marketplace.locale_translations WHERE locale_key IN (
  'customer.aisle.close',
  'customer.aisle.empty.description',
  'customer.aisle.empty.title',
  'customer.aisle.eyebrow',
  'customer.aisle.loading',
  'customer.product.sold_by',
  'customer.results.count',
  'customer.results.empty.description',
  'customer.results.empty.title',
  'customer.results.eyebrow',
  'customer.results.loading',
  'customer.results.title'
);

DELETE FROM marketplace.locale_keys WHERE locale_key IN (
  'customer.aisle.close',
  'customer.aisle.empty.description',
  'customer.aisle.empty.title',
  'customer.aisle.eyebrow',
  'customer.aisle.loading',
  'customer.product.sold_by',
  'customer.results.count',
  'customer.results.empty.description',
  'customer.results.empty.title',
  'customer.results.eyebrow',
  'customer.results.loading',
  'customer.results.title'
);
