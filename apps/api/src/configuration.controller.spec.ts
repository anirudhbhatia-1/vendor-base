import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { ConfigurationController } from './configuration.controller.js';

test('configuration lifecycle preserves maker/checker capabilities', () => {
  for (const method of ['create', 'validate', 'schedule', 'rollback'] as const) {
    const requirement = Reflect.getMetadata(
      AUTHORIZATION_REQUIREMENT,
      ConfigurationController.prototype[method],
    ) as AuthorizationRequirement;
    assert.equal(requirement.capability, 'admin.configuration.propose');
  }
  // Reading the register is neither side of the pair: an approver has to
  // see the version they are asked to approve.
  const listing = Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    ConfigurationController.prototype.list,
  ) as AuthorizationRequirement;
  assert.equal(listing.capability, 'admin.configuration.read');
  const approval = Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    ConfigurationController.prototype.approve,
  ) as AuthorizationRequirement;
  assert.equal(approval.capability, 'admin.configuration.approve');
});

test('rejecting is the approver side; cancelling a schedule and reading are not (11.6)', () => {
  const capability = (method: keyof ConfigurationController) =>
    (
      Reflect.getMetadata(
        AUTHORIZATION_REQUIREMENT,
        ConfigurationController.prototype[method],
      ) as AuthorizationRequirement
    ).capability;
  assert.equal(capability('reject'), 'admin.configuration.approve');
  assert.equal(capability('cancel'), 'admin.configuration.propose');
  for (const method of ['catalogue', 'detail', 'preview'] as const) {
    assert.equal(capability(method), 'admin.configuration.read', method);
  }
});
