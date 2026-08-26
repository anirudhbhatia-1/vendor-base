import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INR,
  addMoney,
  createCurrencyCode,
  createMoney,
  requireNonNegativeMoney,
  subtractMoney,
} from './money.js';

test('stores money only as integer minor units with explicit currency', () => {
  assert.deepEqual(createMoney(12_345, INR), { amount_minor: 12_345, currency: 'INR' });
  assert.throws(() => createMoney(12.34, INR), /safe integer/);
  assert.throws(() => createCurrencyCode('RUPEES'), TypeError);
});

test('performs currency-safe arithmetic including signed ledger values', () => {
  assert.deepEqual(addMoney(createMoney(100, INR), createMoney(25, INR)), {
    amount_minor: 125,
    currency: 'INR',
  });
  assert.deepEqual(subtractMoney(createMoney(100, INR), createMoney(125, INR)), {
    amount_minor: -25,
    currency: 'INR',
  });
  assert.throws(
    () => addMoney(createMoney(100, INR), createMoney(100, createCurrencyCode('USD'))),
    /currencies must match/,
  );
});

test('guards non-negative contexts and numeric overflow', () => {
  assert.throws(() => requireNonNegativeMoney(createMoney(-1, INR)), /must not be negative/);
  assert.throws(
    () => addMoney(createMoney(Number.MAX_SAFE_INTEGER, INR), createMoney(1, INR)),
    /safe integer/,
  );
});
