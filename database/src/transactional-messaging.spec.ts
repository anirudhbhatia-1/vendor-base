import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { outboxBackoffMs } from './transactional-messaging.js';

describe('outbox retry backoff', () => {
  it('doubles from the bounded base and caps at the maximum', () => {
    assert.equal(outboxBackoffMs(1, 100, 1_000), 100);
    assert.equal(outboxBackoffMs(2, 100, 1_000), 200);
    assert.equal(outboxBackoffMs(5, 100, 1_000), 1_000);
    assert.equal(outboxBackoffMs(25, 100, 1_000), 1_000);
  });

  it('rejects invalid retry configuration', () => {
    assert.throws(() => outboxBackoffMs(0), /Attempt count/);
    assert.throws(() => outboxBackoffMs(1, 2_000, 1_000), /cannot exceed/);
    assert.throws(() => outboxBackoffMs(26), /Attempt count/);
  });
});
