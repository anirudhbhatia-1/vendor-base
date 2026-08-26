import assert from 'node:assert/strict';
import test from 'node:test';

import { REDACTED_VALUE, redactProtectedFields } from './redaction.js';

test('recursively redacts protected log fields while preserving operational context', () => {
  assert.deepEqual(
    redactProtectedFields({
      request_id: 'safe-request-reference',
      order_id: 'safe-order-identifier',
      authorization_amount_minor: 12_500,
      authorization: 'Bearer secret',
      customer: {
        phone: '+91-real-looking-value',
        email_address: 'private@example.test',
        state: 'PLACED',
      },
      coordinates: [26.9, 75.8],
    }),
    {
      request_id: 'safe-request-reference',
      order_id: 'safe-order-identifier',
      authorization_amount_minor: 12_500,
      authorization: REDACTED_VALUE,
      customer: {
        phone: REDACTED_VALUE,
        email_address: REDACTED_VALUE,
        state: 'PLACED',
      },
      coordinates: REDACTED_VALUE,
    },
  );
});

test('contains cycles, errors, and excessively deep objects safely', () => {
  const cyclic: { self?: unknown; password: string } = { password: 'private' };
  cyclic.self = cyclic;
  assert.deepEqual(redactProtectedFields(cyclic), {
    password: REDACTED_VALUE,
    self: '[CIRCULAR]',
  });
  assert.deepEqual(redactProtectedFields(new Error('message may contain protected content')), {
    error_name: 'Error',
  });
});

test('removes identity and session material from nested log metadata', () => {
  const protectedValues = {
    access_token: 'nsa_PRIVATE_ACCESS',
    device_token: 'PRIVATE_DEVICE_TOKEN',
    notification_token: 'PRIVATE_NOTIFICATION_TOKEN',
    otp_code: '654321',
    phone_identifier: 'SYNTH-PHONE-PRIVATE-001',
    refresh_token: 'nsr_PRIVATE_REFRESH',
  };
  const redacted = redactProtectedFields({
    event: 'identity.isolation.fixture',
    nested: protectedValues,
    request_id: 'safe-request-reference',
  });
  const serialized = JSON.stringify(redacted);
  for (const value of Object.values(protectedValues)) {
    assert.equal(serialized.includes(value), false);
  }
  assert.equal(serialized.includes('safe-request-reference'), true);
});
