import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import {
  AdminAssignmentController,
  PartnerAssignmentController,
} from './assignment-custody.controller.js';

function authorization(target: object, method: string): AuthorizationRequirement | undefined {
  const handler = (target as Record<string, object>)[method];
  if (!handler) return undefined;
  return Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) as
    AuthorizationRequirement | undefined;
}

test('contains accepted assignment actions to the exact active assignment', () => {
  for (const method of [
    'get',
    'arriveVendor',
    'pickup',
    'beginRoute',
    'arriveCustomer',
    'deliver',
    'fail',
    'requireReturn',
    'beginReturn',
    'completeReturn',
  ]) {
    const rule = authorization(PartnerAssignmentController.prototype, method);
    assert.equal(rule?.delivery_assignment_id_param, 'delivery_assignment_id');
    assert.equal(rule?.conceal_resource, true);
    assert.match(rule?.capability ?? '', /^partner\.assignment\.(read|act)$/);
  }
});

test('uses partner eligibility only for an offer decision', () => {
  for (const method of ['accept', 'decline']) {
    const rule = authorization(PartnerAssignmentController.prototype, method);
    assert.equal(rule?.capability, 'partner.eligibility.read');
    assert.equal(rule?.conceal_resource, true);
  }
});

test('requires scoped delivery operations authority for dispatch commands', () => {
  for (const method of ['create', 'offer', 'authorizeReturn', 'endBeforePickup']) {
    const rule = authorization(AdminAssignmentController.prototype, method);
    assert.equal(rule?.capability, 'admin.delivery.assignment_manage');
    assert.deepEqual(rule?.admin_scope, { kind: 'GLOBAL' });
    assert.equal(rule?.conceal_resource, true);
  }
});
