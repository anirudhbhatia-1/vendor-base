import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFieldError,
  createLocalizationKey,
  createStandardError,
  errorHttpStatus,
} from './errors.js';
import { createRequestId } from './identifiers.js';

test('builds the stable standard error envelope with request reference', () => {
  const requestId = createRequestId({
    now_ms: 1_000,
    random_bytes: (length) => new Uint8Array(length),
  });
  const response = createStandardError('ORDER_STATE_CONFLICT', requestId, {
    current_state: 'READY',
  });

  assert.deepEqual(response, {
    error: {
      code: 'ORDER_STATE_CONFLICT',
      message_key: 'orders.state_conflict',
      request_id: requestId,
      retryable: false,
      field_errors: [],
      current_state: 'READY',
      support_reference: null,
    },
  });
  assert.equal(errorHttpStatus('ORDER_STATE_CONFLICT'), 409);
  assert.equal(errorHttpStatus('SERVICE_UNAVAILABLE'), 503);
});

test('validates field errors and exposes retryability only from the registry', () => {
  const requestId = createRequestId({
    random_bytes: (length) => new Uint8Array(length),
  });
  const fieldError = createFieldError({
    field: 'lines[0].quantity',
    code: 'MUST_BE_POSITIVE',
    message_key: 'validation.must_be_positive',
  });
  const response = createStandardError('RATE_LIMITED', requestId, {
    field_errors: [fieldError],
  });
  assert.equal(response.error.retryable, true);
  assert.deepEqual(response.error.field_errors, [fieldError]);
  assert.throws(
    () => createFieldError({ field: '../secret', code: 'BAD', message_key: 'validation.bad' }),
    /path is invalid/,
  );
  assert.throws(() => createLocalizationKey('Human readable sentence'), /dotted notation/);
});
