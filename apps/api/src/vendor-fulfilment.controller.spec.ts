import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import {
  CustomerDecisionsController,
  CustomerOrderHistoryController,
  VendorOrderFulfilmentController,
} from './vendor-fulfilment.controller.js';

function vendorAuth(
  method: keyof VendorOrderFulfilmentController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    VendorOrderFulfilmentController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}
function decisionAuth(
  method: keyof CustomerDecisionsController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    CustomerDecisionsController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}
function historyAuth(
  method: keyof CustomerOrderHistoryController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    CustomerOrderHistoryController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

const vendorRoutes = [
  'accept',
  'decline',
  'startPicking',
  'markFound',
  'markMissing',
  'proposeSubstitution',
  'proposeWeight',
  'markReady',
  'issueOtp',
  'completePickup',
  'listPicks',
] as const;

test('contains every vendor fulfilment route to vendor.order.fulfil at the owning location', () => {
  for (const method of vendorRoutes) {
    const rule = vendorAuth(method);
    assert.equal(rule?.capability, 'vendor.order.fulfil', `${method} capability`);
    assert.equal(rule.vendor_location_id_param, 'vendor_location_id', `${method} scope`);
    assert.equal(rule.conceal_resource, true, `${method} concealment`);
  }
});

test('scopes the customer decision answer to customer.order.decide with concealment', () => {
  const rule = decisionAuth('answer');
  assert.equal(rule?.capability, 'customer.order.decide');
  assert.equal(rule.conceal_resource, true);
});

test('separates order history, rating, and support behind distinct customer capabilities', () => {
  assert.equal(historyAuth('list')?.capability, 'customer.order.read');
  assert.equal(historyAuth('receipt')?.capability, 'customer.order.read');
  assert.equal(historyAuth('rate')?.capability, 'customer.order.rate');
  assert.equal(historyAuth('support')?.capability, 'customer.support.open');
});

test('declares an authorization requirement on every exposed vendor fulfilment route', () => {
  const exposed = Object.getOwnPropertyNames(VendorOrderFulfilmentController.prototype).filter(
    (name) => name !== 'constructor',
  );
  assert.deepEqual([...exposed].sort(), [...vendorRoutes].sort());
});
