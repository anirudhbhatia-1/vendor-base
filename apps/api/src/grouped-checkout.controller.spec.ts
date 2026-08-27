import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { GroupedCheckoutController } from './grouped-checkout.controller.js';

function authorization(
  method: keyof GroupedCheckoutController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    GroupedCheckoutController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

const ownedRoutes = ['quote', 'place', 'get', 'history'] as const;

test('protects every customer checkout route with the checkout capability', () => {
  for (const method of ownedRoutes) {
    const rule = authorization(method);
    assert.equal(rule?.capability, 'customer.checkout.manage', `${method} capability`);
    assert.equal(rule?.conceal_resource, true, `${method} concealment`);
  }
});

test('leaves only the signed provider webhook outside customer authorization', () => {
  assert.equal(authorization('webhook'), undefined);
  const exposed = Object.getOwnPropertyNames(GroupedCheckoutController.prototype)
    .filter((name) => name !== 'constructor')
    .sort();
  assert.deepEqual(exposed, ['get', 'history', 'place', 'quote', 'webhook']);
});
