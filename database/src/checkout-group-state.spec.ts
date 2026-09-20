import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveCheckoutGroupState } from './checkout-group-state.js';

/** Children as `STATE` (delivered) or `STATE@PICKUP` (collected by the customer). */
const derive = (payment_state: string, ...children: string[]) =>
  deriveCheckoutGroupState({
    payment_state,
    orders: children.map((child) => {
      const [lifecycle_state, method] = child.split('@');
      return {
        lifecycle_state: lifecycle_state ?? child,
        fulfilment_method: method === 'PICKUP' ? 'CUSTOMER_PICKUP' : 'PLATFORM_DELIVERY',
      };
    }),
  });

test('the payment decides the summary until it has authorised', () => {
  assert.equal(derive('PROCESSING'), 'PROCESSING');
  assert.equal(derive('PAYMENT_UNKNOWN'), 'PAYMENT_UNKNOWN');
  assert.equal(derive('CANCELLED'), 'CANCELLED');
  // A declined payment has no children; an abandoned one neither.
  assert.equal(derive('CANCELLED', 'PLACED'), 'CANCELLED');
});

test('an authorised group is what its children are', () => {
  assert.equal(derive('ACTIVE', 'PLACED', 'PLACED'), 'PROCESSING');
  assert.equal(derive('ACTIVE', 'ACCEPTED', 'PLACED'), 'PARTIALLY_ACCEPTED');
  assert.equal(derive('ACTIVE', 'ACCEPTED', 'PICKING'), 'ACTIVE');
  // PICKED_UP is the partner holding a delivery, or a collection completed.
  assert.equal(derive('ACTIVE', 'READY', 'PICKED_UP'), 'ACTIVE');
  assert.equal(derive('ACTIVE', 'READY', 'PICKED_UP@PICKUP'), 'PARTIALLY_COMPLETED');
  assert.equal(derive('ACTIVE', 'DELIVERED', 'PICKING'), 'PARTIALLY_COMPLETED');
  assert.equal(derive('ACTIVE', 'DELIVERED', 'PICKED_UP@PICKUP'), 'COMPLETED');
  assert.equal(derive('ACTIVE', 'DELIVERED', 'PICKED_UP'), 'PARTIALLY_COMPLETED');
  assert.equal(derive('ACTIVE', 'DELIVERED'), 'COMPLETED');
});

test('an order that will never arrive is said before anything else', () => {
  assert.equal(derive('ACTIVE', 'CANCELLED', 'DELIVERED'), 'PARTIALLY_CANCELLED');
  assert.equal(derive('ACTIVE', 'EXPIRED', 'PICKING'), 'PARTIALLY_CANCELLED');
  assert.equal(derive('ACTIVE', 'RETURNED', 'PLACED'), 'PARTIALLY_CANCELLED');
  assert.equal(derive('ACTIVE', 'CANCELLED', 'EXPIRED'), 'CANCELLED');
  // The one derivation that existed counted CANCELLED alone.
  assert.equal(derive('ACTIVE', 'EXPIRED'), 'CANCELLED');
});

test('a group with no orders yet is still being processed', () => {
  assert.equal(derive('ACTIVE'), 'PROCESSING');
});
