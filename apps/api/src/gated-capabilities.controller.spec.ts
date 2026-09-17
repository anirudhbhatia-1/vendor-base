import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { GatedCapabilitiesController } from './gated-capabilities.controller.js';

/**
 * FEATURES.md section 17: gated capabilities "must remain unavailable until
 * their named approvals and controls pass". The register is the enforcement
 * point, so reading it and recording an approval are themselves privileged.
 */
function authorization(method: string): AuthorizationRequirement | undefined {
  const handler = (GatedCapabilitiesController.prototype as unknown as Record<string, unknown>)[
    method
  ];
  if (typeof handler !== 'function') return undefined;
  return Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) as
    AuthorizationRequirement | undefined;
}

test('reading and approving gated capabilities both need the review capability', () => {
  for (const method of ['list', 'approve']) {
    const requirement = authorization(method);
    assert.equal(requirement?.capability, 'admin.gated.review', `${method} capability`);
    assert.deepEqual(requirement?.admin_scope, { kind: 'GLOBAL' }, `${method} scope`);
  }
});

test('the controller exposes only the register and its approval trail', () => {
  const methods = Object.getOwnPropertyNames(GatedCapabilitiesController.prototype)
    .filter((name) => name !== 'constructor')
    .sort();
  assert.deepEqual(methods, ['approve', 'list']);
});
