import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allocateMinorUnits,
  calculateDistanceAmount,
  calculateWaitingAmount,
  LocalFakeMoneyProvider,
} from './money-policy.js';

describe('synthetic financial policy', () => {
  it('calculates distance and waiting amounts in integer paise', () => {
    assert.equal(calculateDistanceAmount(2_000), 1_500);
    assert.equal(calculateDistanceAmount(5_000), 3_900);
    assert.equal(calculateDistanceAmount(2_001), 1_501);
    assert.equal(calculateWaitingAmount(419), 100);
    assert.equal(calculateWaitingAmount(420), 200);
    assert.equal(calculateWaitingAmount(3_600), 1_000);
  });

  it('allocates every paise deterministically in stable order', () => {
    assert.deepEqual(allocateMinorUnits(100, [1, 1, 1]), [34, 33, 33]);
    assert.equal(
      allocateMinorUnits(987_654, [7, 11, 13]).reduce((a, b) => a + b),
      987_654,
    );
  });

  it('deduplicates fake provider operations and preserves unknown outcomes', () => {
    const provider = new LocalFakeMoneyProvider();
    const operation_reference = 'SYNTH-PAY-UNIT-0001';
    assert.equal(
      provider.execute({ amount_minor: 100, operation_reference, scenario: 'UNKNOWN' }),
      'UNKNOWN',
    );
    assert.equal(
      provider.execute({ amount_minor: 100, operation_reference, scenario: 'SUCCESS' }),
      'UNKNOWN',
    );
    assert.throws(() =>
      provider.execute({
        amount_minor: 100,
        operation_reference: 'REAL-PAYMENT',
        scenario: 'SUCCESS',
      }),
    );
  });
});
