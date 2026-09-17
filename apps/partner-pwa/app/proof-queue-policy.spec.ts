import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proofQueueAllowsNewWork, readProofQueue } from './proof-queue-policy';

test('only a fresh successful empty proof read permits new work', async () => {
  const state = await readProofQueue(
    async () => ({ proofs: [] }),
    () => 100,
  );
  assert.equal(proofQueueAllowsNewWork(state, true, 101), true);
  assert.equal(proofQueueAllowsNewWork(state, false, 101), false);
  assert.equal(proofQueueAllowsNewWork(state, true, 30_100), false);
  assert.equal(proofQueueAllowsNewWork(state, true, 99), false);
  assert.equal(proofQueueAllowsNewWork({ status: 'loading' }, true, 100), false);
  assert.equal(proofQueueAllowsNewWork({ status: 'unknown' }, true, 100), false);
});
test('held proofs block new work until an acknowledged successful refresh', async () => {
  const held = await readProofQueue(
    async () => ({ proofs: [{ sync_state: 'PENDING' }] }),
    () => 100,
  );
  assert.equal(proofQueueAllowsNewWork(held, true, 100), false);
  const cleared = await readProofQueue(
    async () => ({ proofs: [] }),
    () => 200,
  );
  assert.equal(proofQueueAllowsNewWork(cleared, true, 200), true);
});
test('permission, concealed route, unavailable and malformed results never become an empty queue', async () => {
  for (const status of [401, 403, 404, 503]) {
    const state = await readProofQueue(async () => {
      throw Object.assign(new Error('Failed'), { status });
    });
    assert.equal(state.status, status === 503 ? 'unavailable' : 'denied');
    assert.equal(proofQueueAllowsNewWork(state, true, 100), false);
  }
  for (const value of [
    null,
    {},
    { proofs: null },
    { proofs: [null] },
    { proofs: [{}] },
    { proofs: [{ sync_state: 'UNRECOGNIZED' }] },
  ]) {
    const state = await readProofQueue(async () => value);
    assert.equal(state.status, 'unavailable');
    assert.equal(proofQueueAllowsNewWork(state, true, 100), false);
  }
});
