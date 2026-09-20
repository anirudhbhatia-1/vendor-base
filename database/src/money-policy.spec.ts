import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  allocateMinorUnits,
  calculateDistanceAmount,
  calculateWaitingAmount,
  LocalFakeMoneyProvider,
  roundHalfUp,
  providerOutcome,
} from './money-policy.js';

describe('rounding to whole minor units', () => {
  it('rounds halves upward and never introduces a fraction of a paisa', () => {
    assert.equal(roundHalfUp(5n, 10n), 1n);
    assert.equal(roundHalfUp(4n, 10n), 0n);
    assert.equal(roundHalfUp(15n, 10n), 2n);
    assert.equal(roundHalfUp(16n, 10n), 2n);
    assert.equal(roundHalfUp(0n, 10n), 0n);
  });

  it('refuses a negative amount rather than rounding it by a whole unit', () => {
    // BigInt division truncates toward zero, so the positive bias term made -1.4
    // come out as 0 and -1.6 as -1. Refusing is the honest behaviour until a
    // convention for negative money is approved.
    assert.throws(() => roundHalfUp(-14n, 10n), /non-negative amounts only/);
    assert.throws(() => roundHalfUp(-16n, 10n), /non-negative amounts only/);
  });

  it('refuses a denominator that cannot define a rounding step', () => {
    assert.throws(() => roundHalfUp(10n, 0n), /denominator must be positive/);
    assert.throws(() => roundHalfUp(10n, -10n), /denominator must be positive/);
  });
});

describe('financial policy', () => {
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
        operation_reference: 'invalid payment reference',
        scenario: 'SUCCESS',
      }),
    );
  });

  it('answers UNKNOWN, never a decline, when the provider does not answer', async () => {
    const provider = new LocalFakeMoneyProvider();
    const garbled = {
      amount_minor: 100,
      operation_reference: 'SYNTH-PAY-UNIT-0002',
      scenario: 'MALFORMED' as const,
    };
    await assert.rejects(() => provider.authorize(garbled));
    assert.equal(await providerOutcome(() => provider.authorize(garbled)), 'UNKNOWN');
    assert.equal(await providerOutcome(() => provider.void(garbled)), 'UNKNOWN');
    assert.equal(
      await providerOutcome(() =>
        provider.void({
          ...garbled,
          operation_reference: 'SYNTH-PAY-UNIT-0003',
          scenario: 'DECLINE',
        }),
      ),
      'DECLINED',
    );
    assert.equal(
      await providerOutcome(() =>
        provider.capture({
          ...garbled,
          operation_reference: 'SYNTH-PAY-UNIT-0004',
          scenario: 'SUCCESS',
        }),
      ),
      'SUCCEEDED',
    );
  });

  it('owns webhook verification and clearing-account configuration inside the adapter', () => {
    const webhookKey = 'unit-test-payment-webhook-key-material';
    const provider = new LocalFakeMoneyProvider({
      clearing_account_reference: 'SYNTH-ACCOUNT-UNIT-CLEARING',
      webhook_key: webhookKey,
    });
    const payload = '{"provider_event_id":"SYNTH-EVENT-1"}';
    const signature = createHmac('sha256', webhookKey).update(payload).digest('hex');
    assert.equal(provider.verifyWebhook({ payload, signature }), true);
    assert.equal(provider.verifyWebhook({ payload: `${payload}x`, signature }), false);
    assert.equal(provider.verifyWebhook({ payload, signature: 'invalid' }), false);
    assert.equal(provider.clearingAccountReference(), 'SYNTH-ACCOUNT-UNIT-CLEARING');
  });
});
