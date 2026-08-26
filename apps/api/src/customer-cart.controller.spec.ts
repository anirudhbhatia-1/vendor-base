import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { CustomerCartController } from './customer-cart.controller.js';

function authorization(method: keyof CustomerCartController): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    CustomerCartController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

const routes = [
  'current',
  'setAddress',
  'addLine',
  'setQuantity',
  'removeLine',
  'setGroupFulfilmentMethod',
  'revalidate',
] as const;

test('keeps every cart route behind the customer cart capability', () => {
  for (const method of routes) {
    const rule = authorization(method);
    assert.equal(rule?.capability, 'customer.cart.manage', `${method} capability`);
  }
});

test('conceals another customer cart rather than confirming it exists', () => {
  for (const method of routes) {
    assert.equal(authorization(method)?.conceal_resource, true, `${method} concealment`);
  }
});

test('declares an authorization requirement on every exposed route', () => {
  const exposed = Object.getOwnPropertyNames(CustomerCartController.prototype).filter(
    (name) => name !== 'constructor',
  );
  assert.deepEqual([...exposed].sort(), [...routes].sort());
});
