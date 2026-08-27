import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCheckoutPricing } from './checkout-pricing.js';

test('prices each vendor group and the combined authorization in integer paise', () => {
  const quote = calculateCheckoutPricing([
    {
      vendor_location_id: 'store-a',
      item_subtotal_minor: 4_800,
      route_metres: 5_000,
      tip_minor: 100,
    },
    {
      vendor_location_id: 'store-b',
      item_subtotal_minor: 2_000,
      route_metres: 2_000,
      tip_minor: 0,
    },
  ]);
  assert.deepEqual(
    quote.groups.map((group) => group.total_minor),
    [8_800, 3_500],
  );
  assert.equal(quote.total_minor, 12_300);
});

test('rejects unsupported group counts and invalid money', () => {
  assert.throws(() => calculateCheckoutPricing([]));
  assert.throws(() =>
    calculateCheckoutPricing([
      { vendor_location_id: 'x', item_subtotal_minor: -1, route_metres: 0, tip_minor: 0 },
    ]),
  );
});
