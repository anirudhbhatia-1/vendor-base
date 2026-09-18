import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestContext, createUuidV7 } from '@neighbourhood-store/domain-types';
import {
  ACKNOWLEDGED_WITHOUT_REACTION,
  handleDomainEvent,
  type DomainEventDependencies,
} from './domain-event-handler.js';

/** Fakes that record what was called, per branch, and answer what the branch needs. */
function dependencies(input: { readonly method?: string } = {}) {
  const calls: string[] = [];
  const deps: DomainEventDependencies = {
    fulfilment: {
      settleInventoryOnPickup: async () => {
        calls.push('settleInventoryOnPickup');
      },
      fulfilmentMethod: async () => {
        calls.push('fulfilmentMethod');
        return input.method ?? 'PLATFORM_DELIVERY';
      },
    },
    dispatch: {
      dispatchPlacedOrder: async () => {
        calls.push('dispatchPlacedOrder');
      },
    },
    orderMoney: {
      settleAuthorizationForOrder: async () => {
        calls.push('settleAuthorizationForOrder');
        return 'CAPTURED';
      },
      recordDeliveryEarnings: async () => {
        calls.push('recordDeliveryEarnings');
        return { earning_posted: false, settled: true };
      },
    },
    adminControl: {
      createSupportCase: async () => {
        calls.push('createSupportCase');
      },
    },
    availability: {
      forceOffline: async () => {
        calls.push('forceOffline');
      },
    },
    log: () => undefined,
    now: () => new Date('2026-09-18T10:00:00.000Z'),
  };
  return { calls, deps };
}

const context = createRequestContext({ actor: null });

function event(type: string) {
  return { event_id: createUuidV7(), event_type: type, aggregate_id: createUuidV7() };
}

test('a collected order settles on pickup: PICKED_UP is its last state', async () => {
  const { calls, deps } = dependencies({ method: 'CUSTOMER_PICKUP' });
  await handleDomainEvent(deps, context, event('vendor_order.picked_up'));
  assert.deepEqual(calls, [
    'settleInventoryOnPickup',
    'fulfilmentMethod',
    'recordDeliveryEarnings',
  ]);
});

test('a delivery is not settled on pickup: it is still on its way', async () => {
  for (const method of ['PLATFORM_DELIVERY', 'VENDOR_DELIVERY']) {
    const { calls, deps } = dependencies({ method });
    await handleDomainEvent(deps, context, event('vendor_order.picked_up'));
    assert.deepEqual(calls, ['settleInventoryOnPickup', 'fulfilmentMethod'], method);
  }
});

test('a delivered order settles, whoever delivered it', async () => {
  const { calls, deps } = dependencies();
  await handleDomainEvent(deps, context, event('vendor_order.delivered'));
  assert.deepEqual(calls, ['recordDeliveryEarnings']);
});

test('each answer to a placed order settles the group authorization', async () => {
  for (const type of ['vendor_order.accepted', 'vendor_order.ended']) {
    const { calls, deps } = dependencies();
    await handleDomainEvent(deps, context, event(type));
    assert.deepEqual(calls, ['settleAuthorizationForOrder'], type);
  }
});

test('a placed order is offered to partners', async () => {
  const { calls, deps } = dependencies();
  await handleDomainEvent(deps, context, event('order.placed'));
  assert.deepEqual(calls, ['dispatchPlacedOrder']);
});

test('a returned order opens a case rather than dividing money', async () => {
  const { calls, deps } = dependencies();
  await handleDomainEvent(deps, context, event('vendor_order.returned'));
  assert.deepEqual(calls, ['createSupportCase']);
});

test('a suspended partner is taken offline', async () => {
  const { calls, deps } = dependencies();
  await handleDomainEvent(deps, context, event('partner.suspended'));
  assert.deepEqual(calls, ['forceOffline']);
});

test('an acknowledged-without-reaction type does nothing and an unknown type fails', async () => {
  for (const type of ACKNOWLEDGED_WITHOUT_REACTION) {
    const { calls, deps } = dependencies();
    await handleDomainEvent(deps, context, event(type));
    assert.deepEqual(calls, [], type);
  }
  const { calls, deps } = dependencies();
  await assert.rejects(
    () => handleDomainEvent(deps, context, event('vendor_order.teleported')),
    /No outbox handler is registered for vendor_order.teleported/,
  );
  assert.deepEqual(calls, []);
});
