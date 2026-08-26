import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { CustomerAddressesController } from './customer-addresses.controller.js';

function authorization(
  method: keyof CustomerAddressesController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    CustomerAddressesController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

const routes = ['list', 'create', 'update', 'select', 'eligible', 'archive'] as const;

test('keeps every saved-address route behind the customer address capability', () => {
  for (const method of routes) {
    const rule = authorization(method);
    assert.equal(rule?.capability, 'customer.address.manage', `${method} capability`);
  }
});

test('conceals another customer address rather than confirming it exists', () => {
  for (const method of routes) {
    assert.equal(authorization(method)?.conceal_resource, true, `${method} concealment`);
  }
});

test('never scopes a customer address route to a vendor location', () => {
  for (const method of routes) {
    const rule = authorization(method);
    assert.equal(rule?.vendor_location_id_param, undefined, `${method} vendor scope`);
  }
});

test('declares an authorization requirement on every exposed route', () => {
  const exposed = Object.getOwnPropertyNames(CustomerAddressesController.prototype).filter(
    (name) => name !== 'constructor',
  );
  assert.deepEqual([...exposed].sort(), [...routes].sort());
});
