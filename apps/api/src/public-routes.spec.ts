import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'reflect-metadata';
import { AppModule } from './app.module.js';
import { AUTHORIZATION_REQUIREMENT, PUBLIC_ROUTE, SESSION_REQUIREMENT } from './authorization.js';

/**
 * Routes are denied by default; this is the complete reviewed list of routes
 * that may answer without a bearer token. Adding a public route means adding
 * it here, in the same change, with the reason its @Public decorator states.
 */
const EXPECTED_PUBLIC = new Set([
  'GET /health/live',
  'GET /health/ready',
  'GET /locale/bundle',
  'POST /auth/otp/request',
  'POST /auth/otp/verify',
  'POST /auth/sessions/refresh',
  'POST /auth/password/verify',
  'GET /catalogue/stores',
  'GET /catalogue/search',
  'GET /catalogue/stores/:vendor_location_id',
  'GET /catalogue/locations/:vendor_location_id/availability',
  'GET /catalogue/maps/config',
  'GET /customer/catalogue/images/:catalogue_image_id',
  'GET /customer/discovery/categories',
  'POST /customer/checkout/provider-webhook',
  // 11.7: what is paused and until when, for every surface's banner.
  'GET /service-status',
]);

const METHOD_NAMES = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'] as const;

type HandlerRecord = {
  readonly route: string;
  readonly guarded: boolean;
  readonly publicReason: string | undefined;
};

function collectHandlers(): HandlerRecord[] {
  const controllers: Array<abstract new (...args: never[]) => unknown> =
    Reflect.getMetadata('controllers', AppModule) ?? [];
  assert.ok(controllers.length > 50, 'the module metadata lists the controllers');
  const records: HandlerRecord[] = [];
  for (const controller of controllers) {
    const rawPrefix = Reflect.getMetadata('path', controller) ?? '';
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      if (name === 'constructor') continue;
      const handler = (controller.prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      const path = Reflect.getMetadata('path', handler);
      const method = Reflect.getMetadata('method', handler);
      if (path === undefined || method === undefined) continue;
      const segments = [String(rawPrefix), String(path)]
        .map((part) => part.replace(/^\/+|\/+$/g, ''))
        .filter((part) => part !== '');
      const route = `${METHOD_NAMES[method as number] ?? method} /${segments.join('/')}`;
      records.push({
        route,
        guarded:
          Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) !== undefined ||
          Reflect.getMetadata(SESSION_REQUIREMENT, handler) !== undefined ||
          Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, controller) !== undefined ||
          Reflect.getMetadata(SESSION_REQUIREMENT, controller) !== undefined,
        publicReason:
          Reflect.getMetadata(PUBLIC_ROUTE, handler) ??
          Reflect.getMetadata(PUBLIC_ROUTE, controller),
      });
    }
  }
  return records;
}

test('every route is guarded, or public by written decision — never merely undecorated', () => {
  const undecided = collectHandlers()
    .filter((record) => !record.guarded && record.publicReason === undefined)
    .map((record) => record.route)
    .sort();
  assert.deepEqual(undecided, [], `routes with no auth decision:\n${undecided.join('\n')}`);
});

test('the public surface is exactly the reviewed list', () => {
  const declared = collectHandlers().filter((record) => record.publicReason !== undefined);
  const declaredRoutes = new Set(declared.map((record) => record.route));
  const unexpected = [...declaredRoutes].filter((route) => !EXPECTED_PUBLIC.has(route)).sort();
  const missing = [...EXPECTED_PUBLIC].filter((route) => !declaredRoutes.has(route)).sort();
  assert.deepEqual(
    unexpected,
    [],
    `public routes not in the reviewed list: ${unexpected.join(', ')}`,
  );
  assert.deepEqual(missing, [], `reviewed public routes no longer declared: ${missing.join(', ')}`);
  for (const record of declared) {
    assert.ok(
      (record.publicReason ?? '').trim().length >= 10,
      `${record.route} must state a real public reason`,
    );
  }
});

test('a route that is public must not also demand authorization', () => {
  const conflicted = collectHandlers()
    .filter((record) => record.guarded && record.publicReason !== undefined)
    .map((record) => record.route);
  assert.deepEqual(conflicted, []);
});
