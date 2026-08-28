import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { ConfigurationController } from './configuration.controller.js';

test('configuration lifecycle preserves maker/checker capabilities', () => {
  for (const method of ['list', 'create', 'validate', 'schedule', 'rollback'] as const) {
    const requirement = Reflect.getMetadata(
      AUTHORIZATION_REQUIREMENT,
      ConfigurationController.prototype[method],
    ) as AuthorizationRequirement;
    assert.equal(requirement.capability, 'admin.configuration.propose');
  }
  const approval = Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    ConfigurationController.prototype.approve,
  ) as AuthorizationRequirement;
  assert.equal(approval.capability, 'admin.configuration.approve');
});
