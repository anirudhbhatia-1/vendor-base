import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CustomerCatalogueImageController,
  CustomerCategoriesController,
  MapsConfigController,
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
  assert.deepEqual(methodsOf(MapsConfigController.prototype), ['config']);
});

test('no pre-sign-in route carries an authorization requirement', () => {
  for (const controller of [
    PublicDiscoveryController,
    CustomerCategoriesController,
    CustomerCatalogueImageController,
    MapsConfigController,
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

/**
 * The maps configuration hands a browser the public token and nothing else:
 * a secret (sk.) token is never given out, and no provider means no token.
 */
test('the maps configuration gives out only a public token, and none when maps are off', () => {
  const routing = (provider: 'estimate' | 'mapbox', token: string | undefined) =>
    new MapsConfigController({
      routing: { provider, mapboxAccessToken: token, profile: 'driving', timeoutMs: 4_000 },
    } as never).config();
  const on = routing('mapbox', 'pk.eyJ1IjoidW5pdCIsImEiOiJ0ZXN0MDEyMyJ9.unit-test-signature');
  assert.equal(on.provider, 'mapbox');
  assert.match(on.access_token ?? '', /^pk\./);
  assert.equal(on.country, 'in');
  const secret = routing('mapbox', 'sk.eyJ1IjoidW5pdCIsImEiOiJ0ZXN0MDEyMyJ9.unit-test-signature');
  assert.deepEqual([secret.provider, secret.access_token], ['none', null]);
  const off = routing('estimate', undefined);
  assert.deepEqual([off.provider, off.access_token], ['none', null]);
});
