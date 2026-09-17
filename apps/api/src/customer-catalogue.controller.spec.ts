import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CustomerCatalogueImageController,
  CustomerCategoriesController,
  PublicDiscoveryController,
} from './customer-catalogue.controller.js';
import { AUTHORIZATION_REQUIREMENT } from './authorization.js';

function authorization(prototype: object, method: string): unknown {
  const handler = (prototype as Record<string, unknown>)[method];
  return handler === undefined
    ? undefined
    : Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler as object);
}

function methodsOf(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype).filter((name) => name !== 'constructor');
}

/**
 * These routes are public on purpose, and the list is deliberately short.
 * `architecture.md` §6.1 asks for public store pages so a visitor can browse
 * before signing in; anything personal must stay on the authenticated
 * `customer/discovery/*` routes.
 */
test('the pre-sign-in catalogue surface is exactly these routes', () => {
  assert.deepEqual(methodsOf(PublicDiscoveryController.prototype).sort(), [
    'search',
    'storefront',
    'stores',
  ]);
  assert.deepEqual(methodsOf(CustomerCategoriesController.prototype), ['list']);
  assert.deepEqual(methodsOf(CustomerCatalogueImageController.prototype), ['image']);
});

test('no pre-sign-in route carries an authorization requirement', () => {
  for (const controller of [
    PublicDiscoveryController,
    CustomerCategoriesController,
    CustomerCatalogueImageController,
  ]) {
    for (const method of methodsOf(controller.prototype)) {
      assert.equal(
        authorization(controller.prototype, method),
        undefined,
        `${controller.name}.${method} must stay reachable before sign-in`,
      );
    }
  }
});

/**
 * The one way this change could leak something.
 *
 * A public projection must never carry a fact about a person. Favourites, the
 * preferred store, recent searches and discovery events are all keyed to a
 * user, so the public service methods must not touch them.
 */
test('the public discovery reads cannot return anything personal', () => {
  const source = readFileSync(
    new URL('../../../database/src/customer-discovery.ts', import.meta.url),
    'utf8',
  );
  const publicMethods = ['discoverStoresNear', 'searchProductsNear', 'publicStorefront'];
  for (const name of publicMethods) {
    const start = source.indexOf(`async ${name}(`);
    assert.ok(start > 0, `${name} must exist`);
    // Up to the next method declaration.
    const rest = source.slice(start + name.length);
    const end = rest.search(/\n {2}(?:async |#|\/\*\*)/);
    const body = rest.slice(0, end === -1 ? rest.length : end);
    for (const forbidden of ['recordEvent', '#recordSearch', 'favourite', 'preferred', 'user_id']) {
      assert.ok(
        !body.includes(forbidden),
        `${name} must not reference ${forbidden}: a signed-out response carries no personal data`,
      );
    }
  }
});
