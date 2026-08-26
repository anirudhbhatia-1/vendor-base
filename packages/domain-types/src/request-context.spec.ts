import assert from 'node:assert/strict';
import test from 'node:test';

import { createUuidV7, type RandomBytes } from './identifiers.js';
import {
  attachAuthenticatedActor,
  createAuthenticatedActor,
  createCommandEnvelope,
  createEventEnvelope,
  createJobEnvelope,
  createProviderCallContext,
  createRequestContext,
  createTraceContext,
  formatTraceparent,
} from './request-context.js';

const nonZeroRandom: RandomBytes = (length) => new Uint8Array(length).fill(1);

function identifier(nowMs: number): string {
  return createUuidV7({ now_ms: nowMs, random_bytes: nonZeroRandom });
}

test('generates a root request, correlation, and W3C trace context', () => {
  const context = createRequestContext({ random_bytes: nonZeroRandom });

  assert.equal(context.request_id, context.correlation_id);
  assert.equal(context.causation_id, null);
  assert.equal(context.actor, null);
  assert.match(formatTraceparent(context.trace), /^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
});

test('validates supplied request and trace headers and creates a server span', () => {
  const requestId = identifier(1_000);
  const traceparent = '00-11111111111111111111111111111111-2222222222222222-01';
  const context = createRequestContext({
    request_id: requestId,
    traceparent,
    random_bytes: nonZeroRandom,
  });

  assert.equal(context.request_id, requestId);
  assert.equal(context.trace.trace_id, '11111111111111111111111111111111');
  assert.equal(context.trace.parent_span_id, '2222222222222222');
  assert.equal(context.trace.trace_flags, '01');
  assert.notEqual(context.trace.span_id, context.trace.parent_span_id);
  assert.throws(
    () => createRequestContext({ request_id: 'not-a-uuid', random_bytes: nonZeroRandom }),
    /UUIDv7/,
  );
  assert.throws(
    () =>
      createTraceContext({
        traceparent: '00-00000000000000000000000000000000-2222222222222222-01',
      }),
    /valid W3C/,
  );
});

test('attaches only validated authenticated actor context', () => {
  const actor = createAuthenticatedActor({
    actor_id: identifier(2_000),
    actor_kind: 'vendor_staff',
    session_id: identifier(3_000),
  });
  const context = attachAuthenticatedActor(
    createRequestContext({ random_bytes: nonZeroRandom }),
    actor,
  );

  assert.deepEqual(context.actor, actor);
  assert.throws(
    () =>
      createAuthenticatedActor({
        actor_id: identifier(2_000),
        actor_kind: 'unknown' as 'admin',
        session_id: identifier(3_000),
      }),
    /actor kind/,
  );
});

test('propagates correlation and causation through command, event, job, and provider calls', () => {
  const root = createRequestContext({ random_bytes: nonZeroRandom });
  const cause = identifier(4_000);
  const command = createCommandEnvelope({
    caused_by: cause,
    context: root,
    message_id: identifier(5_000),
    payload: { order_id: identifier(6_000) },
    random_bytes: nonZeroRandom,
  });
  const event = createEventEnvelope({
    caused_by: command.message_id,
    context: command.context,
    message_id: identifier(7_000),
    payload: { state: 'PLACED' },
    random_bytes: nonZeroRandom,
  });
  const job = createJobEnvelope({
    caused_by: event.message_id,
    context: event.context,
    message_id: identifier(8_000),
    payload: { deadline: 'vendor.response_seconds' },
    random_bytes: nonZeroRandom,
  });
  const provider = createProviderCallContext({
    caused_by: job.message_id,
    context: job.context,
    operation_id: identifier(9_000),
    random_bytes: nonZeroRandom,
  });

  assert.equal(command.kind, 'command');
  assert.equal(event.kind, 'event');
  assert.equal(job.kind, 'job');
  for (const propagated of [command.context, event.context, job.context, provider.context]) {
    assert.equal(propagated.request_id, root.request_id);
    assert.equal(propagated.correlation_id, root.correlation_id);
  }
  assert.equal(command.context.causation_id, cause);
  assert.equal(event.context.causation_id, command.message_id);
  assert.equal(job.context.causation_id, event.message_id);
  assert.equal(provider.context.causation_id, job.message_id);
});
