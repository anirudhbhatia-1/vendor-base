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

/** A seeded generator, so a failing case reproduces from its seed. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % below;
  };
}

test('every division conserves what the customer paid, whatever the order (10.7)', () => {
  const next = seeded(20_270_707);
  for (let run = 0; run < 2_000; run += 1) {
    const goods = next(200_000);
    const delivery = next(10_000);
    const tip = next(5_000);
    const captured = goods + delivery + tip;
    const refunds = next(captured + 1);
    const goodsRefunds = Math.min(next(refunds + 1), goods);
    const partner = next(delivery + tip + 1);
    const input = order({
      captured_minor: captured,
      refunds_minor: refunds,
      goods_minor: goods,
      goods_refunds_minor: goodsRefunds,
      partner_payable_minor: partner,
      commission_basis_points: next(3_001),
      fee_applies: next(2) === 1,
    });
    const division = divideOrder(input);
    const seen = JSON.stringify({ run, input, division });
    assert.equal(division.customer_net_minor, captured - refunds, seen);
    assert.equal(
      division.vendor_payable_minor +
        division.partner_payable_minor +
        division.platform_remainder_minor,
      division.customer_net_minor,
      seen,
    );
    assert.ok(division.vendor_payable_minor >= 0 && division.vendor_fee_minor >= 0, seen);
    // The platform's share is the remainder, so the three always sum; what
    // can drift is the shop's goods, which divide exactly into its payable
    // and the fee.
    assert.equal(
      division.vendor_payable_minor + division.vendor_fee_minor,
      division.remaining_goods_minor,
      seen,
    );
    assert.equal(division.remaining_goods_minor, goods - goodsRefunds, seen);
    assert.ok(division.vendor_payable_minor <= goods - goodsRefunds, seen);
    for (const value of Object.values(division)) assert.ok(Number.isSafeInteger(value), seen);
  }
});
