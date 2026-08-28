import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import {
  AdminPartnerDispatchController,
  PartnerAvailabilityController,
} from './partner-availability.controller.js';
test('partner availability is account scoped and dispatch search is global-admin scoped', () => {
  for (const method of ['summary', 'set'] as const) {
    const r = Reflect.getMetadata(
      AUTHORIZATION_REQUIREMENT,
      PartnerAvailabilityController.prototype[method],
    ) as AuthorizationRequirement;
    assert.equal(r.capability, 'partner.availability.manage');
    assert.equal(r.conceal_resource, true);
  }
  const d = Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    AdminPartnerDispatchController.prototype.list,
  ) as AuthorizationRequirement;
  assert.equal(d.capability, 'admin.delivery.partner_dispatch');
  assert.deepEqual(d.admin_scope, { kind: 'GLOBAL' });
});
