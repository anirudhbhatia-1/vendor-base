import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type RandomBytes,
} from '@neighbourhood-store/domain-types';
import {
  currentRequestContext,
  optionalRequestContext,
  requestContextStorage,
  runWithAuthenticatedActor,
} from './request-context-storage.js';

const randomBytes: RandomBytes = (length) => new Uint8Array(length).fill(1);

test('attaches a verified actor only within the active request context', async () => {
  const root = createRequestContext({ random_bytes: randomBytes });
  const actor = createAuthenticatedActor({
    actor_id: createUuidV7({ now_ms: 1_000, random_bytes: randomBytes }),
    actor_kind: 'admin',
    session_id: createUuidV7({ now_ms: 2_000, random_bytes: randomBytes }),
  });

  assert.equal(optionalRequestContext(), undefined);
  await requestContextStorage.run(root, async () => {
    assert.equal(currentRequestContext().actor, null);
    await runWithAuthenticatedActor(actor, async () => {
      await Promise.resolve();
      assert.deepEqual(currentRequestContext().actor, actor);
      assert.equal(currentRequestContext().request_id, root.request_id);
    });
    assert.equal(currentRequestContext().actor, null);
  });
  assert.equal(optionalRequestContext(), undefined);
});
