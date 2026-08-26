import assert from 'node:assert/strict';
import test from 'node:test';

import { createUuidV7 } from './identifiers.js';
import {
  createDeadlinePolicyKey,
  createGrams,
  createMetres,
  createSeconds,
  createVersionedDeadline,
} from './quantities.js';

test('accepts only non-negative integer metres, grams, and seconds', () => {
  assert.equal(createMetres(5_000), 5_000);
  assert.equal(createGrams(750), 750);
  assert.equal(createSeconds(300), 300);
  assert.throws(() => createMetres(-1), /non-negative safe integer/);
  assert.throws(() => createGrams(2.5), /non-negative safe integer/);
});

test('creates versioned deadlines with stable policy and configuration identity', () => {
  const configurationId = createUuidV7({
    now_ms: 1_000,
    random_bytes: (length) => new Uint8Array(length),
  });
  assert.deepEqual(
    createVersionedDeadline({
      policy_key: 'vendor.response_seconds',
      configuration_version_id: configurationId,
      starts_at: '2026-08-20T10:00:00Z',
      expires_at: '2026-08-20T10:05:00Z',
    }),
    {
      policy_key: 'vendor.response_seconds',
      configuration_version_id: configurationId,
      starts_at: '2026-08-20T10:00:00.000Z',
      expires_at: '2026-08-20T10:05:00.000Z',
    },
  );
});

test('rejects unstable policy keys and non-forward deadlines', () => {
  const configurationId = createUuidV7({
    random_bytes: (length) => new Uint8Array(length),
  });
  assert.throws(() => createDeadlinePolicyKey('Vendor Response'), /stable lowercase/);
  assert.throws(
    () =>
      createVersionedDeadline({
        policy_key: 'vendor.response_seconds',
        configuration_version_id: configurationId,
        starts_at: '2026-08-20T10:00:00Z',
        expires_at: '2026-08-20T10:00:00Z',
      }),
    /later than starts_at/,
  );
});
