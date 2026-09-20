import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { createRequestContext } from '@neighbourhood-store/domain-types';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { GroupedCheckoutController } from './grouped-checkout.controller.js';
import { requestContextStorage } from './request-context-storage.js';

function authorization(
  method: keyof GroupedCheckoutController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    GroupedCheckoutController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

const ownedRoutes = ['quote', 'place', 'get', 'history'] as const;

test('protects every customer checkout route with the checkout capability', () => {
  for (const method of ownedRoutes) {
    const rule = authorization(method);
    assert.equal(rule?.capability, 'customer.checkout.manage', `${method} capability`);
    assert.equal(rule?.conceal_resource, true, `${method} concealment`);
  }
});

test('leaves only the signed provider webhook outside customer authorization', () => {
  assert.equal(authorization('webhook'), undefined);
  const exposed = Object.getOwnPropertyNames(GroupedCheckoutController.prototype)
    .filter((name) => name !== 'constructor')
    .sort();
  assert.deepEqual(exposed, ['get', 'history', 'place', 'quote', 'webhook']);
});

test('refuses a webhook outcome it does not know instead of reading it as a failure', async () => {
  const received: unknown[] = [];
  const service = {
    receiveWebhook: async (input: unknown) => {
      received.push(input);
      return { replayed: false };
    },
  };
  const controller = new GroupedCheckoutController(
    service as unknown as ConstructorParameters<typeof GroupedCheckoutController>[0],
  );
  const body = {
    provider_event_id: 'SYNTH-EVENT-UNIT-1',
    provider_operation_reference: 'SYNTH-PAY-UNIT-1',
    occurred_at: new Date().toISOString(),
  };
  for (const outcome of ['PENDING', 'succeeded', undefined, 42]) {
    await assert.rejects(
      () => controller.webhook({ ...body, outcome }, 'ab'.repeat(32)),
      (error: unknown) => (error as { status?: number }).status === 400,
      `outcome ${String(outcome)} reached the service`,
    );
  }
  assert.equal(received.length, 0);
  await requestContextStorage.run(createRequestContext(), () =>
    controller.webhook({ ...body, outcome: 'FAILED' }, 'ab'.repeat(32)),
  );
  assert.equal((received[0] as { outcome: string }).outcome, 'FAILED');
});
