import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCheckoutPricing, type CheckoutPricingGroupInput } from './checkout-pricing.js';
import { allocateMinorUnits, SYNTHETIC_FINANCIAL_POLICY } from './money-policy.js';

const policy = {
  policy: SYNTHETIC_FINANCIAL_POLICY,
  version_reference: 'SYNTH-POLICY-FIN-V1-TEST0001',
} as const;

test('prices each vendor group and the combined authorization in integer paise', () => {
  const quote = calculateCheckoutPricing(
    [
      {
        vendor_location_id: 'store-a',
        fulfilment_method: 'PLATFORM_DELIVERY',
        item_subtotal_minor: 4_800,
        route_metres: 5_000,
        tip_minor: 100,
      },
      {
        vendor_location_id: 'store-b',
        fulfilment_method: 'VENDOR_DELIVERY',
        item_subtotal_minor: 2_000,
        route_metres: 2_000,
        tip_minor: 0,
      },
    ],
    policy,
  );
  assert.deepEqual(
    quote.groups.map((group) => group.total_minor),
    [8_800, 3_500],
  );
  assert.equal(quote.total_minor, 12_300);
});

test('a collected order carries no delivery fee however far away the customer lives', () => {
  const quote = calculateCheckoutPricing(
    [
      {
        vendor_location_id: 'store-a',
        fulfilment_method: 'CUSTOMER_PICKUP',
        item_subtotal_minor: 4_800,
        route_metres: 5_000,
        tip_minor: 0,
      },
      {
        vendor_location_id: 'store-b',
        fulfilment_method: 'PLATFORM_DELIVERY',
        item_subtotal_minor: 4_800,
        route_metres: 5_000,
        tip_minor: 0,
      },
    ],
    policy,
  );
  const [collected, delivered] = quote.groups;
  assert.equal(collected?.delivery_minor, 0);
  assert.equal(collected?.total_minor, 4_800);
  assert.equal(delivered?.delivery_minor, 3_900);
  assert.equal(delivered?.total_minor, 8_700);
  assert.equal(quote.total_minor, 13_500);
});

test('rejects unsupported group counts and invalid money', () => {
  assert.throws(() => calculateCheckoutPricing([], policy));
  assert.throws(() =>
    calculateCheckoutPricing(
      [
        {
          vendor_location_id: 'x',
          fulfilment_method: 'PLATFORM_DELIVERY',
          item_subtotal_minor: -1,
          route_metres: 0,
          tip_minor: 0,
        },
      ],
      policy,
    ),
  );
});

/**
 * D-05's rules and worked examples, driven as a table (7.1 requirement 5).
 * Each row is a quote a person could check against
 * docs/finance/test-financial-policy.md by hand.
 */
function delivered(route_metres: number, item_subtotal_minor = 30_000, tip_minor = 0) {
  return {
    vendor_location_id: 'store',
    fulfilment_method: 'PLATFORM_DELIVERY',
    item_subtotal_minor,
    route_metres,
    tip_minor,
  } satisfies CheckoutPricingGroupInput;
}

const D05_EXAMPLES: readonly {
  readonly name: string;
  readonly group: CheckoutPricingGroupInput;
  readonly delivery_minor: number;
  readonly total_minor: number;
}[] = [
  {
    name: 'worked example 1: a normal completed 5 km order pays ₹300 + ₹39 + ₹10',
    group: delivered(5_000, 30_000, 1_000),
    delivery_minor: 3_900,
    total_minor: 34_900,
  },
  {
    name: 'the base fee includes the first 2 km exactly',
    group: delivered(2_000),
    delivery_minor: 1_500,
    total_minor: 31_500,
  },
  {
    name: 'one metre past the included distance is 0.8 paise, rounded half-up to 1',
    group: delivered(2_001),
    delivery_minor: 1_501,
    total_minor: 31_501,
  },
  {
    name: 'three metres past is 2.4 paise, rounded down to 2',
    group: delivered(2_003),
    delivery_minor: 1_502,
    total_minor: 31_502,
  },
  {
    name: 'seven metres past is 5.6 paise, rounded up to 6',
    group: delivered(2_007),
    delivery_minor: 1_506,
    total_minor: 31_506,
  },
  {
    name: 'the outer 40 km boundary is still priced: ₹15 + 38 × ₹8',
    group: delivered(40_000),
    delivery_minor: 31_900,
    total_minor: 61_900,
  },
  {
    name: 'a zero-distance route pays the base fee, not nothing',
    group: delivered(0),
    delivery_minor: 1_500,
    total_minor: 31_500,
  },
];

for (const example of D05_EXAMPLES) {
  test(`D-05: ${example.name}`, () => {
    const quote = calculateCheckoutPricing([example.group], policy);
    const [group] = quote.groups;
    assert.equal(group?.delivery_minor, example.delivery_minor);
    assert.equal(group?.total_minor, example.total_minor);
    assert.equal(quote.total_minor, example.total_minor);
    // D-05: synthetic tax and discount are explicit zeros, never omitted.
    assert.equal(group?.tax_minor, 0);
    assert.equal(group?.discount_minor, 0);
    assert.equal(quote.currency, 'INR');
  });
}

test('D-05: a route past the 40 km synthetic boundary is refused, not priced', () => {
  assert.throws(() => calculateCheckoutPricing([delivered(40_001)], policy), /boundary/);
});

test('D-05 worked example 6: a fictional ₹1 tax over three equal lines is 34, 33, 33 paise', () => {
  const shares = allocateMinorUnits(100, [1, 1, 1]);
  assert.deepEqual([...shares], [34, 33, 33]);
  assert.equal(
    shares.reduce((sum, share) => sum + share, 0),
    100,
  );
});

test('rejects overflow: three groups whose sum passes the amount ceiling', () => {
  const near = delivered(0, 1_000_000_000);
  assert.doesNotThrow(() =>
    calculateCheckoutPricing([{ ...near, item_subtotal_minor: 999_998_000 }], policy),
  );
  assert.throws(
    () =>
      calculateCheckoutPricing(
        [
          { ...near, vendor_location_id: 'a', item_subtotal_minor: 400_000_000 },
          { ...near, vendor_location_id: 'b', item_subtotal_minor: 400_000_000 },
          { ...near, vendor_location_id: 'c', item_subtotal_minor: 400_000_000 },
        ],
        policy,
      ),
    /Checkout total/,
  );
});

test('rejects invalid rounding inputs: a fractional or non-finite amount is not money', () => {
  assert.throws(() => calculateCheckoutPricing([delivered(0, 100.5)], policy), /Item subtotal/);
  assert.throws(() => calculateCheckoutPricing([delivered(0, 100, 0.5)], policy), /Tip/);
  assert.throws(() => calculateCheckoutPricing([delivered(Number.NaN)], policy), /route metres/);
  assert.throws(() => calculateCheckoutPricing([delivered(1_000.5)], policy), /route metres/);
});

test('stamps the policy version that priced the quote', () => {
  const quote = calculateCheckoutPricing([delivered(5_000)], {
    ...policy,
    version_reference: 'SYNTH-POLICY-FIN-V7-ABCDEF01',
  });
  assert.equal(quote.policy_version_reference, 'SYNTH-POLICY-FIN-V7-ABCDEF01');
});
