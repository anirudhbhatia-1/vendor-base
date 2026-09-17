import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { redactProtectedFields } from '@neighbourhood-store/domain-types';
import { closeQueuesWithin, reportQueueErrors, requireQueueReady } from './queue-readiness.js';

type Recorded = { readonly event: string; readonly metadata: Record<string, unknown> };

function recorder() {
  const entries: Recorded[] = [];
  return {
    entries,
    logger: {
      event(event: string, metadata: Record<string, unknown> = {}) {
        entries.push({ event, metadata });
      },
    } as never,
  };
}

test('an unreachable queue reports once, not once per retry', () => {
  // BullMQ opens a client per Queue, QueueEvents and Worker, each retrying for
  // ever. Unhandled, that is three unbounded streams of identical stack traces
  // that bury every other app sharing the terminal.
  const { entries, logger } = recorder();
  const emitters = [new EventEmitter(), new EventEmitter(), new EventEmitter()];
  reportQueueErrors({
    component: 'operations',
    emitters: emitters as never,
    logger,
    queueUrl: 'redis://127.0.0.1:6379',
  });

  const failure = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
    code: 'ECONNREFUSED',
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    for (const emitter of emitters) emitter.emit('error', failure);
  }

  assert.equal(entries.length, 1, '150 driver errors produce one report');
  assert.equal(entries[0]?.event, 'worker.queue.unavailable');
});

test('the report carries the endpoint and the first response (OPS-05)', () => {
  const { entries, logger } = recorder();
  const emitter = new EventEmitter();
  reportQueueErrors({
    component: 'operations',
    emitters: [emitter] as never,
    logger,
    queueUrl: 'redis://127.0.0.1:6379',
  });
  emitter.emit('error', Object.assign(new Error('nope'), { code: 'ECONNREFUSED' }));

  const metadata = entries[0]?.metadata ?? {};
  assert.equal(metadata['queue_endpoint'], '127.0.0.1:6379');
  assert.match(String(metadata['first_response']), /pnpm db:up/);
});

test('the endpoint survives log redaction', () => {
  // Naming this field `queue_address` printed `[REDACTED]`: the redactor treats
  // any `*_address` as protected, correctly, since it cannot tell a queue host
  // from a customer's doorstep. The field is named to avoid that, rather than
  // the redactor being weakened.
  const redacted = redactProtectedFields({ queue_endpoint: '127.0.0.1:6379' }) as Record<
    string,
    unknown
  >;
  assert.equal(redacted['queue_endpoint'], '127.0.0.1:6379');
  const stillProtected = redactProtectedFields({ queue_address: '127.0.0.1:6379' }) as Record<
    string,
    unknown
  >;
  assert.notEqual(stillProtected['queue_address'], '127.0.0.1:6379');
});

test('startup fails with an actionable message instead of hanging', async () => {
  // `waitUntilReady()` never settles while the backend refuses connections, so
  // without a bound the worker sits "starting" for ever while the log fills.
  await assert.rejects(
    requireQueueReady({
      queueUrl: 'redis://127.0.0.1:6379',
      ready: [new Promise(() => {})],
      timeoutMs: 50,
    }),
    /did not accept a connection within 0s[\s\S]*pnpm db:up/,
  );
});

test('a reachable queue resolves without complaint', async () => {
  await requireQueueReady({
    queueUrl: 'redis://127.0.0.1:6379',
    ready: [Promise.resolve('ready')],
    timeoutMs: 1_000,
  });
});

test('a graceful close that overruns its grace period is reported, not awaited', async () => {
  // BullMQ's close() waits for the active job and is idempotent, so a later
  // close(true) cannot escalate it. Shutdown has to stop waiting on its own.
  const { entries, logger } = recorder();
  const started = Date.now();
  await closeQueuesWithin({
    close: () => new Promise<void>(() => undefined),
    component: 'operations',
    graceMs: 20,
    logger,
  });
  assert.ok(Date.now() - started < 1_000, 'shutdown must not block on the hung close');
  const reported = entries.find((entry) => entry.event === 'worker.shutdown.incomplete');
  assert.ok(reported, 'an abandoned close must say so');
  assert.equal(reported.metadata.component, 'operations');
  assert.match(String(reported.metadata.first_response), /idempotent/);
});

test('a close that finishes inside the grace period reports nothing', async () => {
  const { entries, logger } = recorder();
  await closeQueuesWithin({
    close: async () => undefined,
    component: 'finance-scheduler',
    graceMs: 1_000,
    logger,
  });
  assert.deepEqual(
    entries.filter((entry) => entry.event === 'worker.shutdown.incomplete'),
    [],
  );
});
