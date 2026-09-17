import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import {
  CustomerOrderHistoryController,
  CustomerSupportCaseController,
} from './vendor-fulfilment.controller.js';

/**
 * Cancellation, tracking and support visibility are customer-scoped reads and
 * writes over other people's money and someone else's custody, so each carries
 * its own capability and conceals the resource on refusal — a 404-shaped denial
 * rather than one that confirms the order exists.
 */
function requirement(
  controller: { prototype: object },
  method: string,
): AuthorizationRequirement | undefined {
  const handler = (controller.prototype as Record<string, unknown>)[method];
  if (typeof handler !== 'function') return undefined;
  return Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) as
    AuthorizationRequirement | undefined;
}

test('reading a cancellation preview and tracking needs customer.order.read', () => {
  for (const method of ['cancellationPreview', 'tracking']) {
    const found = requirement(CustomerOrderHistoryController, method);
    assert.equal(found?.capability, 'customer.order.read', `${method} capability`);
    assert.equal(found?.conceal_resource, true, `${method} concealment`);
  }
});

test('cancelling is a decision, not a read', () => {
  const found = requirement(CustomerOrderHistoryController, 'cancel');
  assert.equal(found?.capability, 'customer.order.decide');
  assert.equal(found?.conceal_resource, true);
});

test('a customer sees only their own support cases', () => {
  const found = requirement(CustomerSupportCaseController, 'list');
  assert.equal(found?.capability, 'customer.order.read');
  assert.equal(found?.conceal_resource, true);
});
