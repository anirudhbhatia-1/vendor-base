import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { AdminAccessController } from './admin-access.controller.js';

test('admin membership grant and revoke require the global access-management capability', () => {
  for (const method of ['grant', 'revoke'] as const) {
    const requirement = Reflect.getMetadata(
      AUTHORIZATION_REQUIREMENT,
      AdminAccessController.prototype[method],
    ) as AuthorizationRequirement;
    assert.equal(requirement.capability, 'admin.access.role_manage');
    assert.deepEqual(requirement.admin_scope, { kind: 'GLOBAL' });
  }
});
