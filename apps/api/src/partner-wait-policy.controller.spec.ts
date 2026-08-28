import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { PartnerWaitPolicyController } from './partner-wait-policy.controller.js';

test('partner wait policy remains assignment scoped for every operation', () => {
  for (const method of ['get', 'start', 'refresh', 'leave'] as const) {
    const requirement = Reflect.getMetadata(
      AUTHORIZATION_REQUIREMENT,
      PartnerWaitPolicyController.prototype[method],
    ) as AuthorizationRequirement;
    assert.equal(requirement.capability, 'partner.assignment.act');
    assert.equal(requirement.delivery_assignment_id_param, 'delivery_assignment_id');
    assert.equal(requirement.conceal_resource, true);
  }
});
