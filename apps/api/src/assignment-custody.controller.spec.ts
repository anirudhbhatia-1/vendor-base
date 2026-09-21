import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { createRequestContext } from '@neighbourhood-store/domain-types';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { requestContextStorage } from './request-context-storage.js';
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

test('a partner reads their own compensation record with the earnings capability (9.3)', () => {
  const rule = authorization(PartnerAssignmentController.prototype, 'compensations');
  assert.equal(rule?.capability, 'partner.earnings.read');
  assert.equal(rule?.conceal_resource, true);
});

test('a reassignment is routed to reassign() with its compensation, not to endBeforePickup (9.3)', async () => {
  const calls: string[] = [];
  const controller = new AdminAssignmentController({
    reassign: async (input: { compensation_minor: number; reason_code: string; note?: string }) => {
      calls.push(`reassign:${input.compensation_minor}:${input.reason_code}:${input.note ?? '-'}`);
      return { assignment_state: 'UNASSIGNED' };
    },
    endBeforePickup: async () => {
      calls.push('end');
      return { assignment_state: 'CANCELLED' };
    },
  } as never);
  await requestContextStorage.run(createRequestContext(), async () => {
    const result = await controller.endBeforePickup('01a0c40b-070f-7393-8216-0df916eb851f', {
      command_reference: 'SYNTH-CMD-REASSIGN-T1',
      compensation_minor: 1500,
      expected_version: 3,
      reason_code: 'PARTNER_VEHICLE_BREAKDOWN',
      resulting_state: 'REASSIGNED',
    });
    assert.deepEqual(result, { assignment_state: 'UNASSIGNED' });
    assert.deepEqual(calls, ['reassign:1500:PARTNER_VEHICLE_BREAKDOWN:-']);
    await controller.endBeforePickup('01a0c40b-070f-7393-8216-0df916eb851f', {
      command_reference: 'SYNTH-CMD-CANCEL-T1',
      expected_version: 3,
      reason_code: 'CUSTOMER_CANCELLED_BEFORE_PICKUP',
      resulting_state: 'CANCELLED',
    });
  });
  assert.deepEqual(calls, ['reassign:1500:PARTNER_VEHICLE_BREAKDOWN:-', 'end']);
});

test('an arrival carries the device fix when there is one, and is a bare claim when there is not (9.4)', async () => {
  const seen: unknown[] = [];
  const controller = new PartnerAssignmentController({
    arriveAtVendor: async (input: { position?: unknown }) => {
      seen.push(input.position ?? 'none');
      return { assignment_state: 'ASSIGNED' };
    },
  } as never);
  await requestContextStorage.run(createRequestContext(), async () => {
    await controller.arriveVendor('01a0c40b-070f-7393-8216-0df916eb851f', {
      command_reference: 'SYNTH-CMD-ARRIVE-T1',
      expected_version: 2,
      reason_code: 'PARTNER_CONFIRMED',
      latitude: 26.91,
      longitude: 75.81,
      accuracy_meters: 15,
    });
    await controller.arriveVendor('01a0c40b-070f-7393-8216-0df916eb851f', {
      command_reference: 'SYNTH-CMD-ARRIVE-T2',
      expected_version: 3,
      reason_code: 'PARTNER_CONFIRMED',
    });
    // A fix without an accuracy is not trusted as a good one.
    await controller.arriveVendor('01a0c40b-070f-7393-8216-0df916eb851f', {
      command_reference: 'SYNTH-CMD-ARRIVE-T3',
      expected_version: 4,
      reason_code: 'PARTNER_CONFIRMED',
      latitude: 26.91,
      longitude: 75.81,
    });
  });
  assert.deepEqual(seen, [
    { latitude: 26.91, longitude: 75.81, accuracy_meters: 15 },
    'none',
    { latitude: 26.91, longitude: 75.81, accuracy_meters: 101 },
  ]);
});
