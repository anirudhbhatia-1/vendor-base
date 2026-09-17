import assert from 'node:assert/strict';
import test from 'node:test';
import { displayedOrderState, orderCodeAvailable } from './order-code-policy.js';

const pickup = (lifecycle_state: string) => ({
  lifecycle_state,
  fulfilment_method: 'CUSTOMER_PICKUP',
});
const delivery = (lifecycle_state: string) => ({
  lifecycle_state,
  fulfilment_method: 'PLATFORM_DELIVERY',
});

test('a delivery code is offered while a partner holds the goods, and only then', () => {
  // The states a vendor order can be in (migrations 0026, 0055). OUT_FOR_DELIVERY
  // is deliberately absent: it was the state the card waited for, and no order
  // ever reaches it.
  const states = [
    'PLACED',
    'ACCEPTED',
    'PICKING',
    'AWAITING_CUSTOMER_DECISION',
    'READY',
    'PICKED_UP',
    'DELIVERED',
    'RETURNED',
    'CANCELLED',
    'EXPIRED',
  ];
  for (const state of states) {
    assert.equal(
      orderCodeAvailable(delivery(state)),
      state === 'PICKED_UP' ? 'DELIVERY' : null,
      `delivery order in ${state}`,
    );
    assert.equal(
      orderCodeAvailable(pickup(state)),
      state === 'READY' ? 'COLLECTION' : null,
      `pickup order in ${state}`,
    );
  }
  // An order whose method is unknown is treated as a delivery, as the server does.
  assert.equal(
    orderCodeAvailable({ lifecycle_state: 'PICKED_UP', fulfilment_method: null }),
    'DELIVERY',
  );
});

test('a delivery that has left the shop is "on the way", not "collected"', () => {
  assert.equal(displayedOrderState(delivery('PICKED_UP')), 'OUT_FOR_DELIVERY');
  assert.equal(displayedOrderState(pickup('PICKED_UP')), 'PICKED_UP');
  assert.equal(displayedOrderState(delivery('READY')), 'READY');
  assert.equal(displayedOrderState(delivery('delivered')), 'DELIVERED');
});
