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

test('leaving goes back to dispatch at the store and fails the delivery at the door (9.5)', async () => {
  const { createRequestContext } = await import('@neighbourhood-store/domain-types');
  const { requestContextStorage } = await import('./request-context-storage.js');
  const calls: string[] = [];
  const controller = new PartnerWaitPolicyController(
    {
      leave: async () => {
        calls.push('door');
        return { wait_state: 'LEFT_POLICY' };
      },
    } as never,
    {
      get: async () => ({
        assignment_state: calls.length === 0 ? 'AT_VENDOR' : 'ARRIVED',
        version: 4,
      }),
      leaveStoreAfterWait: async (input: { expected_version: number }) => {
        calls.push(`store:v${input.expected_version}`);
        return { assignment_state: 'UNASSIGNED' };
      },
    } as never,
  );
  await requestContextStorage.run(createRequestContext(), async () => {
    const atStore = await controller.leave('01a0c40b-070f-7393-8216-0df916eb851f', {
      command_reference: 'SYNTH-CMD-LEAVE-T1',
      reason_code: 'PARTNER_LEFT_AFTER_WAIT',
    });
    assert.deepEqual(atStore, { assignment_state: 'UNASSIGNED' });
    const atDoor = await controller.leave('01a0c40b-070f-7393-8216-0df916eb851f', {
      command_reference: 'SYNTH-CMD-LEAVE-T2',
      reason_code: 'PARTNER_LEFT_AFTER_WAIT',
    });
    assert.deepEqual(atDoor, { wait_state: 'LEFT_POLICY' });
  });
  assert.deepEqual(calls, ['store:v4', 'door']);
});
