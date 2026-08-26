import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { CustomerDiscoveryController } from './customer-discovery.controller.js';

function authorization(
  method: keyof CustomerDiscoveryController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    CustomerDiscoveryController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

const routes = [
  'stores',
  'search',
  'recentSearches',
  'deleteRecentSearch',
  'storefront',
  'addFavourite',
  'removeFavourite',
  'favourites',
  'setPreferredStore',
  'clearPreferredStore',
  'preferredStore',
  'requestShop',
] as const;

test('keeps every discovery route behind the customer discovery capability', () => {
  for (const method of routes) {
    const rule = authorization(method);
    assert.equal(rule?.capability, 'customer.discovery.use', `${method} capability`);
  }
});

test('conceals discovery resources rather than confirming another customer state', () => {
  for (const method of routes) {
    assert.equal(authorization(method)?.conceal_resource, true, `${method} concealment`);
  }
});

test('declares an authorization requirement on every exposed route', () => {
  const exposed = Object.getOwnPropertyNames(CustomerDiscoveryController.prototype).filter(
    (name) => name !== 'constructor',
  );
  assert.deepEqual([...exposed].sort(), [...routes].sort());
});
