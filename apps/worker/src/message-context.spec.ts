import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createJobEnvelope,
  createRequestContext,
  createUuidV7,
  type RandomBytes,
} from '@neighbourhood-store/domain-types';
import { optionalMessageContext, runWithMessageContext } from './message-context.js';

const randomBytes: RandomBytes = (length) => new Uint8Array(length).fill(1);

test('makes propagated request context available for the complete worker handler', async () => {
  const root = createRequestContext({ random_bytes: randomBytes });
  const cause = createUuidV7({ now_ms: 1_000, random_bytes: randomBytes });
  const message = createJobEnvelope({
    caused_by: cause,
    context: root,
    payload: { synthetic: true },
    random_bytes: randomBytes,
  });

  assert.equal(optionalMessageContext(), undefined);
  await runWithMessageContext(message, async () => {
    await Promise.resolve();
    assert.equal(optionalMessageContext()?.request_id, root.request_id);
    assert.equal(optionalMessageContext()?.correlation_id, root.correlation_id);
    assert.equal(optionalMessageContext()?.causation_id, cause);
  });
  assert.equal(optionalMessageContext(), undefined);
});
