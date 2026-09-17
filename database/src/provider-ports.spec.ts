import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LocalDeterministicGeocodingProvider,
  LocalDeterministicMessageProvider,
  LocalDeterministicRouteProvider,
} from './provider-ports.js';

describe('local provider ports', () => {
  it('keeps retry behavior inside the message adapter', async () => {
    const provider = new LocalDeterministicMessageProvider();
    const base = {
      operation_reference: 'NOTICE-UNIT-1',
      payload: Object.freeze({ order: 'ORDER-1' }),
      scenario: 'TRANSIENT_FAILURE' as const,
    };
    assert.equal((await provider.send({ ...base, attempt: 1 })).retryable, true);
    assert.equal((await provider.send({ ...base, attempt: 3 })).state, 'DELIVERED');
  });

  it('provides deterministic mapping adapters without external SDK coupling', async () => {
    const route = await new LocalDeterministicRouteProvider().route({
      origin: [75.7628, 26.8505],
      destination: [75.7873, 26.9124],
    });
    assert.ok(route.distance_metres > 0);
    assert.ok(route.duration_seconds > 0);
    const area = await new LocalDeterministicGeocodingProvider().reverse({
      latitude: 26.8505,
      longitude: 75.7628,
    });
    assert.match(area.area_label, /^SYNTH AREA /);
  });
});
