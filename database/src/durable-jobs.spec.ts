import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { durableJobBackoffMs } from './durable-jobs.js';

describe('durable job retry backoff', () => {
  it('grows exponentially and remains capped for lifetime attempt numbers', () => {
    assert.equal(durableJobBackoffMs(1, 250, 2_000), 250);
    assert.equal(durableJobBackoffMs(2, 250, 2_000), 500);
    assert.equal(durableJobBackoffMs(4, 250, 2_000), 2_000);
    assert.equal(durableJobBackoffMs(100, 250, 2_000), 2_000);
  });

  it('rejects unsafe retry bounds', () => {
    assert.throws(() => durableJobBackoffMs(0), /Attempt count/);
    assert.throws(() => durableJobBackoffMs(101), /Attempt count/);
    assert.throws(() => durableJobBackoffMs(1, 2_000, 1_000), /cannot exceed/);
  });
});
