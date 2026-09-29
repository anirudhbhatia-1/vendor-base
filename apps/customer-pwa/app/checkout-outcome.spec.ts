import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '@neighbourhood-store/contracts';
import {
  bufferSentence,
  classifyPlacementFailure,
  decisionRuleSentence,
  pausedCheckout,
  pausedSentence,
} from './checkout-outcome';

const t = (_key: string, fallback: string) => fallback;

test('the checkout’s own answers are told apart by code', () => {
  assert.deepEqual(classifyPlacementFailure(new ApiError(409, 'x', { code: 'PAYMENT_DECLINED' })), {
    kind: 'declined',
  });
  assert.deepEqual(classifyPlacementFailure(new ApiError(409, 'x', { code: 'QUOTE_EXPIRED' })), {
    kind: 'quote_expired',
  });
  assert.deepEqual(classifyPlacementFailure(new ApiError(409, 'x', { code: 'QUOTE_CHANGED' })), {
    kind: 'quote_changed',
  });
});

test('an answer that never arrived is not a refusal', () => {
  for (const cause of [
    new TypeError('fetch failed'),
    new ApiError(502, 'Bad gateway'),
    new ApiError(503, 'Unavailable', { code: 'SERVICE_UNAVAILABLE' }),
    new ApiError(429, 'Slow down', { code: 'RATE_LIMITED' }),
    new ApiError(408, 'Timed out'),
    'offline',
  ]) {
    assert.equal(classifyPlacementFailure(cause).kind, 'interrupted', String(cause));
  }
});

test('a definitive refusal is shown as itself, never retried blindly', () => {
  const refused = classifyPlacementFailure(
    new ApiError(409, 'Inventory hold is unavailable', { code: 'ORDER_STATE_CONFLICT' }),
  );
  assert.deepEqual(refused, { kind: 'refused', message: 'Inventory hold is unavailable' });
  assert.equal(classifyPlacementFailure(new ApiError(404, 'gone')).kind, 'refused');
});

test('the decision rule and the buffer are always said', () => {
  assert.equal(decisionRuleSentence('NO_SUBSTITUTION', t), 'it is refunded, never replaced');
  assert.equal(decisionRuleSentence('MIXED', t), 'each item follows the rule you set for it');
  assert.match(bufferSentence({ authorization_buffer_minor: 0 }, String, t), /No buffer/);
  assert.match(
    bufferSentence({ authorization_buffer_minor: 500 }, (m) => `₹${m}`, t),
    /₹500/,
  );
});

test('a paused checkout names its way forward (11.7)', () => {
  assert.deepEqual(
    classifyPlacementFailure(new ApiError(409, 'x', { code: 'GROUPED_CHECKOUT_PAUSED' })),
    { kind: 'paused', pause: 'GROUPED' },
  );
  assert.deepEqual(classifyPlacementFailure(new ApiError(409, 'x', { code: 'PAYMENT_PAUSED' })), {
    kind: 'paused',
    pause: 'PAYMENT',
  });
  assert.equal(pausedCheckout(new ApiError(409, 'x', { code: 'QUOTE_CHANGED' })), null);
  assert.match(pausedSentence('GROUPED', t), /one store at a time/);
  assert.match(pausedSentence('PAYMENT', t), /Choose another/);
});
