import assert from 'node:assert/strict';
import test from 'node:test';
import {
  annotateHeld,
  forgetHeld,
  heldDigest,
  heldSentence,
  holdCompletion,
  listHeld,
  memoryKeyStore,
  recallCompletion,
} from './held-proof.js';

function storage() {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    raw: store,
  };
}

const completion = {
  command_reference: 'SYNTH-CMD-DELIVER-HELD-1',
  expected_version: 7,
  otp: '424242',
  proof_reference: 'SYNTH-PROOF-DELIVERY-HELD-1',
  captured_at: '2026-09-21T10:00:00.000Z',
};

test('a held completion is encrypted at rest and bound to its assignment and partner (9.7)', async () => {
  const local = storage();
  const keys = memoryKeyStore();
  const { digest } = await holdCompletion(local, keys, {
    assignment_id: 'a1',
    partner_id: 'p1',
    completion,
  });
  assert.match(digest, /^[a-f0-9]{64}$/);
  // The code is not readable from storage.
  const stored = [...local.raw.values()].join('');
  assert.ok(!stored.includes('424242'));
  assert.ok(!stored.includes('SYNTH-CMD-DELIVER-HELD-1'));
  assert.equal(await heldDigest(local, 'a1'), digest);
  assert.deepEqual(
    await recallCompletion(local, keys, { assignment_id: 'a1', partner_id: 'p1' }),
    completion,
  );
  // Another job, another account, another device: nothing opens.
  assert.equal(
    await recallCompletion(local, keys, { assignment_id: 'a2', partner_id: 'p1' }),
    null,
  );
  assert.equal(
    await recallCompletion(local, keys, { assignment_id: 'a1', partner_id: 'p2' }),
    null,
  );
  assert.equal(
    await recallCompletion(local, memoryKeyStore(), { assignment_id: 'a1', partner_id: 'p1' }),
    null,
  );
});

test('what is held is listed, annotated, said honestly, and forgotten once confirmed', async () => {
  const local = storage();
  const keys = memoryKeyStore();
  await holdCompletion(local, keys, { assignment_id: 'a1', partner_id: 'p1', completion });
  assert.deepEqual(listHeld(local), [
    {
      assignment_id: 'a1',
      captured_at: completion.captured_at,
      offline_proof_id: null,
      failure: null,
    },
  ]);
  annotateHeld(local, 'a1', { offline_proof_id: 'proof-1' });
  assert.equal(listHeld(local)[0]?.offline_proof_id, 'proof-1');
  const now = Date.parse('2026-09-21T10:12:00.000Z');
  const first = listHeld(local)[0];
  assert.ok(first);
  assert.equal(
    heldSentence(first, now),
    'Proof held on this device 12 min ago. The delivery is not confirmed yet — it sends when you have signal.',
  );
  annotateHeld(local, 'a1', { failure: 'DELIVERY_OTP_EXPIRED' });
  const refused = listHeld(local)[0];
  assert.ok(refused);
  assert.match(heldSentence(refused, now), /refused it \(delivery otp expired\)/);
  forgetHeld(local, 'a1');
  assert.deepEqual(listHeld(local), []);
});
