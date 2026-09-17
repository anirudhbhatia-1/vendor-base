import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { AdminOnboardingController } from './admin-onboarding.controller.js';

function authorization(
  method: keyof AdminOnboardingController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    AdminOnboardingController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

test('createVendor requires the vendor-provision capability with GLOBAL admin scope', () => {
  const req = authorization('createVendor');
  assert.equal(req?.capability, 'admin.onboarding.vendor.provision');
  assert.deepEqual(req?.admin_scope, { kind: 'GLOBAL' });
});

test('createPartner requires the partner-provision capability with GLOBAL admin scope', () => {
  const req = authorization('createPartner');
  assert.equal(req?.capability, 'admin.onboarding.partner.provision');
  assert.deepEqual(req?.admin_scope, { kind: 'GLOBAL' });
});

test('both onboarding routes do not conceal the resource (creation returns the new ids)', () => {
  for (const method of ['createVendor', 'createPartner'] as const) {
    assert.equal(authorization(method)?.conceal_resource, false, `${method} concealment`);
  }
});

/**
 * Nest records a handler's route path under this metadata key. It is exported as
 * `PATH_METADATA` from `@nestjs/common/constants`, which ships no type
 * declarations, so the key is declared locally.
 */
const PATH_METADATA = 'path';

/** True only for methods Nest actually registers as HTTP routes. */
function isRoute(prototype: object, name: string): boolean {
  const handler = (prototype as Record<string, unknown>)[name];
  return typeof handler === 'function' && Reflect.hasMetadata(PATH_METADATA, handler);
}

test('the controller exposes exactly its reviewed onboarding routes', () => {
  const methods = Object.getOwnPropertyNames(AdminOnboardingController.prototype)
    .filter((name) => name !== 'constructor' && isRoute(AdminOnboardingController.prototype, name))
    .sort();
  assert.deepEqual(methods, [
    'createPartner',
    'createVendor',
    'listPartners',
    'listVendors',
    'reinstatePartner',
    'reinstateVendor',
    'suspendPartner',
    'suspendVendor',
  ]);
});

test('every onboarding route carries an admin capability', () => {
  for (const method of Object.getOwnPropertyNames(AdminOnboardingController.prototype)) {
    if (method === 'constructor') continue;
    if (!isRoute(AdminOnboardingController.prototype, method)) continue;
    const req = authorization(method as keyof AdminOnboardingController);
    assert.ok(req?.capability, `${method} must declare a capability`);
  }
});
