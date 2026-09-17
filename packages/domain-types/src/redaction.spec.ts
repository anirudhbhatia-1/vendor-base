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

test('redacts protected fields written in camelCase, not only snake_case', () => {
  // Only `-` was normalized, so `phoneNumber` and `accessToken` were logged in full
  // while `phone_number` and `access_token` were redacted. Provider payloads are the
  // obvious way in, since most arrive camelCase.
  const redacted = redactProtectedFields({
    accessToken: 'tok',
    deviceToken: 'dev',
    otpCode: '123456',
    phoneNumber: '+919876543210',
    refreshToken: 'ref',
  }) as Record<string, unknown>;
  for (const key of ['accessToken', 'deviceToken', 'otpCode', 'phoneNumber', 'refreshToken']) {
    assert.equal(redacted[key], REDACTED_VALUE, key);
  }
});

test('redacts the payment, bank, identity and location fields this marketplace handles', () => {
  const redacted = redactProtectedFields({
    aadhaar: '1234 5678 9012',
    account_number: '123456789012',
    ifsc: 'HDFC0001234',
    lat: 26.9,
    lng: 75.8,
    mobile: '+919876543210',
    pan: 'ABCDE1234F',
    upi_id: 'someone@okhdfc',
    vpa: 'someone@okhdfc',
  }) as Record<string, unknown>;
  for (const key of Object.keys(redacted)) {
    assert.equal(redacted[key], REDACTED_VALUE, key);
  }
});

test('leaves operational fields legible, so redaction does not blind the logs', () => {
  // `latency_ms` must survive the `lat` entry, and `account_reference` and
  // `template_payload` are non-secret identifiers the logs are read for.
  const kept = {
    account_reference: 'SYNTH-ACCOUNT-VENDOR-PAYABLE',
    correlation_id: '01a0-corr',
    latency_ms: 42,
    planned_at: '2026-09-07T00:00:00.000Z',
    platform: 'android',
    vendor_location_id: '01a0-loc',
  };
  assert.deepEqual(redactProtectedFields(kept), kept);
});
