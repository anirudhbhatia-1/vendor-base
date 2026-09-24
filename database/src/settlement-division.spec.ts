import assert from 'node:assert/strict';
import test from 'node:test';
import { divideOrder, OrderDivisionError, type OrderDivisionInput } from './settlement-division.js';

const order = (overrides: Partial<OrderDivisionInput> = {}): OrderDivisionInput => ({
  captured_minor: 34_900,
  refunds_minor: 0,
  goods_minor: 30_000,
  goods_refunds_minor: 0,
  partner_payable_minor: 4_900,
  commission_basis_points: 500,
  fee_applies: true,
  ...overrides,
});

test('a completed order pays commission on the goods and the platform keeps the rest', () => {
  const division = divideOrder(order());
  assert.deepEqual(division, {
    customer_net_minor: 34_900,
    remaining_goods_minor: 30_000,
    vendor_fee_minor: 1_500,
    vendor_payable_minor: 28_500,
    partner_payable_minor: 4_900,
    platform_remainder_minor: 1_500,
  });
});

test('only the goods refunded come off the shop; a delivery refund is the platform’s', () => {
  // A ₹5 delivery refund: the shop's goods and its commission are untouched.
  const delivery = divideOrder(order({ refunds_minor: 500 }));
  assert.equal(delivery.vendor_payable_minor, 28_500);
  assert.equal(delivery.vendor_fee_minor, 1_500);
  assert.equal(delivery.platform_remainder_minor, 1_000);
  // A ₹60 item refund: the goods and the commission both follow the return.
  const items = divideOrder(order({ refunds_minor: 6_000, goods_refunds_minor: 6_000 }));
  assert.equal(items.remaining_goods_minor, 24_000);
  assert.equal(items.vendor_fee_minor, 1_200);
  assert.equal(items.vendor_payable_minor, 22_800);
});

test('an order that did not complete pays no commission, before or after a refund', () => {
  assert.equal(divideOrder(order({ fee_applies: false })).vendor_fee_minor, 0);
  assert.equal(divideOrder(order({ fee_applies: false, refunds_minor: 500 })).vendor_fee_minor, 0);
});

test('a fully refunded order pays the shop nothing and charges it nothing', () => {
  const division = divideOrder(
    order({ refunds_minor: 34_900, goods_refunds_minor: 30_000, partner_payable_minor: 0 }),
  );
  assert.equal(division.vendor_payable_minor, 0);
  assert.equal(division.vendor_fee_minor, 0);
  assert.equal(division.platform_remainder_minor, 0);
});

test('the division always conserves what the customer paid net of refunds', () => {
  for (const captured of [0, 1, 999, 34_900, 1_000_001]) {
    for (const goodsShare of [0, 0.3, 1]) {
      const goods = Math.floor(captured * goodsShare);
      for (const refunded of [0, Math.floor(goods / 3), goods]) {
        for (const bps of [0, 1, 500, 10_000]) {
          for (const fee_applies of [true, false]) {
            const division = divideOrder({
              captured_minor: captured,
              refunds_minor: refunded,
              goods_minor: goods,
              goods_refunds_minor: refunded,
              partner_payable_minor: 0,
              commission_basis_points: bps,
              fee_applies,
            });
            assert.equal(
              division.vendor_payable_minor +
                division.partner_payable_minor +
                division.platform_remainder_minor,
              division.customer_net_minor,
            );
            assert.ok(division.vendor_payable_minor >= 0);
            assert.ok(Number.isSafeInteger(division.vendor_fee_minor));
          }
        }
      }
    }
  }
});

test('impossible inputs are refused rather than divided', () => {
  assert.throws(() => divideOrder(order({ goods_refunds_minor: 1 })), OrderDivisionError);
  assert.throws(() => divideOrder(order({ refunds_minor: 34_901 })), OrderDivisionError);
  assert.throws(() => divideOrder(order({ goods_minor: 1.5 })), OrderDivisionError);
  assert.throws(() => divideOrder(order({ partner_payable_minor: -1 })), OrderDivisionError);
});
