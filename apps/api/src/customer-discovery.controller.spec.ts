import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import {
  AdminShopRequestController,
  CustomerDiscoveryController,
} from './customer-discovery.controller.js';

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

/**
 * The shop-request queue is an operator surface over customer-submitted data,
 * so it must never be reachable with the customer capability, and every route
 * on it must be global-scope admin: reading under review, moving under manage.
 */
function adminAuthorization(
  method: keyof AdminShopRequestController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    AdminShopRequestController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

test('the shop-request queue is read under review and moved under manage, globally', () => {
  assert.equal(adminAuthorization('list')?.capability, 'admin.vendor_onboarding.read');
  for (const method of ['triage', 'close'] as const) {
    assert.equal(adminAuthorization(method)?.capability, 'admin.vendor_onboarding.manage', method);
  }
  for (const method of ['list', 'triage', 'close'] as const) {
    assert.deepEqual(adminAuthorization(method)?.admin_scope, { kind: 'GLOBAL' }, method);
    assert.equal(adminAuthorization(method)?.conceal_resource, true, method);
  }
  const exposed = Object.getOwnPropertyNames(AdminShopRequestController.prototype).filter(
    (name) => name !== 'constructor',
  );
  assert.deepEqual(exposed.sort(), ['close', 'list', 'triage']);
});
