import { expectFailClosed, spawnCaptured } from '../../../tooling/scripts/smoke-support.mjs';
import { createUuidV7 } from '@neighbourhood-store/domain-types';
import pg from 'pg';
import { loadRuntimeConfig } from '../dist/runtime-config.js';

const { child, captured } = spawnCaptured({
  cwd: new URL('..', import.meta.url),
  entry: 'dist/main.js',
  env: { APP_ENV: 'test', UNUSED_SECRET_SENTINEL: 'SYNTHETIC_SENTINEL_2_3' },
});

async function waitForReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (captured.text.includes('"event":"worker.ready"')) return;
    if (child.exitCode !== null) throw new Error(`Worker exited early. Output: ${captured.text}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for worker readiness. Output: ${captured.text}`);
}

/**
 * Liveness has to be readable by something other than this process.
 *
 * Start and stop were asserted from the worker's own stdout, which proves the
 * worker believes it started -- nothing more. `/health/ready` could not see that
 * belief, so it reported queue health from the presence of two PostgreSQL tables
 * and a deployment with no consumer at all looked healthy. These assertions
 * require the durable heartbeat (migration 0071) that readiness actually reads.
 */
// The child is started with APP_ENV=test, but this script's own process is not,
// so resolving the connection string here without it pointed the assertions at the
// *local* database while the worker wrote to the *test* one -- a missing-table
// error that reads exactly like a missing migration.
const workerDatabaseUrl = (() => {
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = 'test';
  try {
    return loadRuntimeConfig().databaseUrl;
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'APP_ENV');
    else process.env.APP_ENV = previous;
  }
})();
const pool = new pg.Pool({ connectionString: workerDatabaseUrl, max: 1 });
async function liveHeartbeat() {
  const result = await pool.query(
    `SELECT worker_id, component, queues, environment, stopped_at, last_seen_at, started_at
       FROM marketplace.worker_heartbeats
      WHERE component = 'marketplace.worker'
      ORDER BY last_seen_at DESC LIMIT 1`,
  );
  return result.rows[0];
}

/** Set once the canary is created, so the outer `finally` can always clean it up. */
let canary;

try {
  await waitForReady();

  // The heartbeat is written asynchronously so it must not delay readiness; poll
  // for it rather than assume it has landed by the time `worker.ready` is logged.
  let heartbeat;
  const heartbeatDeadline = Date.now() + 10_000;
  while (Date.now() < heartbeatDeadline) {
    heartbeat = await liveHeartbeat();
    if (heartbeat && heartbeat.stopped_at === null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!heartbeat || heartbeat.stopped_at !== null) {
    throw new Error('A running worker recorded no durable liveness, so readiness cannot see it');
  }
  if (heartbeat.environment !== 'test' || heartbeat.queues.length === 0) {
    throw new Error('Worker liveness did not record its environment and queues');
  }
  if (!(heartbeat.last_seen_at >= heartbeat.started_at)) {
    throw new Error('Worker liveness recorded an impossible time ordering');
  }

  // Queue canary: a real event through the real path, bounded and cleaned up.
  //
  // Broker reachability and worker liveness are each necessary and neither is
  // sufficient: a reachable Valkey with a live worker can still fail to move a
  // single job. This inserts an outbox event, waits for the worker to publish and
  // acknowledge it, and removes it again.
  // Guarded rather than trusted: this writes rows that cannot be deleted, so it
  // must never reach a shared or long-lived database.
  if (!/:5433\/neighbourhood_store_test$/.test(workerDatabaseUrl)) {
    throw new Error(
      'The queue canary refuses to run outside the disposable test database, because ' +
        'append-only outbox rows cannot be removed once written.',
    );
  }
  // `createUuidV7()` returns a v4 and every identifier on this path is parsed as
  // UUIDv7, so the handler rejected the job and the row sat in PUBLISHING --
  // indistinguishable from a stalled queue.
  canary = { aggregateId: createUuidV7(), eventId: createUuidV7(), requestId: createUuidV7() };
  const {
    aggregateId: canaryAggregateId,
    eventId: canaryEventId,
    requestId: canaryRequestId,
  } = canary;
  // Every outbox event must reference a real aggregate version transition
  // (`outbox_transition_fk`), so the canary writes one rather than bypassing the
  // invariant. That is the point: it travels the same path a business event does.
  // The transition in turn requires an aggregate head. The canary satisfies every
  // link in the chain rather than bypassing any of them, which is what makes it a
  // fair test of the path a business event takes.
  await pool.query(
    `INSERT INTO marketplace.aggregate_heads (aggregate_type, aggregate_id, version, state)
     VALUES ('ops_canary',$1,1,'OBSERVED')`,
    [canaryAggregateId],
  );
  await pool.query(
    `INSERT INTO marketplace.aggregate_transitions
       (transition_id, aggregate_type, aggregate_id, previous_version, resulting_version,
        from_state, to_state, actor_id, actor_kind, reason_code, evidence,
        request_id, correlation_id, causation_id)
     VALUES ($1,'ops_canary',$2,0,1,NULL,'OBSERVED',$3,'system','QUEUE_CANARY','{}'::jsonb,$4,$4,NULL)`,
    [createUuidV7(), canaryAggregateId, createUuidV7(), canaryRequestId],
  );
  await pool.query(
    `INSERT INTO marketplace.outbox_events
       (event_id, aggregate_type, aggregate_id, aggregate_version, event_type, payload,
        request_id, correlation_id, causation_id, max_attempts)
     VALUES ($1,'ops_canary',$2,1,'ops.queue_canary','{}'::jsonb,$3,$3,NULL,3)`,
    [canaryEventId, canaryAggregateId, canaryRequestId],
  );
  let canaryStatus;
  // `operations.tick` fires every 15s and a poll runs a long sequence of passes
  // before dispatch, so a 30s window landed inside the first tick and reported a
  // stalled queue that was merely not due yet. This clears several ticks.
  const canaryDeadline = Date.now() + 90_000;
  while (Date.now() < canaryDeadline) {
    const row = await pool.query(
      'SELECT status FROM marketplace.outbox_events WHERE event_id = $1',
      [canaryEventId],
    );
    canaryStatus = row.rows[0]?.status;
    if (canaryStatus === 'PUBLISHED') break;
    if (canaryStatus === 'DEAD_LETTER') break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (canaryStatus !== 'PUBLISHED') {
    throw new Error(
      `The queue canary was not consumed (status ${canaryStatus ?? 'missing'}). ` +
        'A reachable broker and a live worker do not prove jobs are flowing. ' +
        `Worker captured.text: ${captured.text.slice(-1500)}`,
    );
  }

  child.kill('SIGTERM');
  const result = await new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0 && result.signal !== 'SIGTERM') {
    throw new Error(`Worker exited unexpectedly. Output: ${captured.text}`);
  }
  if (!captured.text.includes('"event":"worker.stopped"'))
    throw new Error('Graceful stop was not logged');

  // A worker that stopped on purpose must be distinguishable from one that
  // vanished mid-job, otherwise a clean deploy looks identical to a crash.
  const stopped = await pool.query(
    'SELECT stopped_at FROM marketplace.worker_heartbeats WHERE worker_id = $1',
    [heartbeat.worker_id],
  );
  if (!stopped.rows[0] || stopped.rows[0].stopped_at === null) {
    throw new Error('A gracefully stopped worker was not recorded as stopped');
  }
  if (captured.text.includes('SYNTHETIC_SENTINEL_2_3'))
    throw new Error('Worker logged an environment secret');
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  // The canary cleans up whether or not it passed: a failing run that leaves rows
  // behind poisons the next one, which is how the first stuck row was mistaken for
  // a second failure.
  // The canary leaves its rows behind, deliberately and unavoidably.
  //
  // `outbox_events` is append-only -- deleting one raises "messaging history is
  // append-only" from the guard added in migration 0066 -- so a canary that
  // travels the real event path cannot tidy up after itself. Swallowing that
  // error to look clean would be the same lie the false-empty proof queue told.
  //
  // Cleanup is satisfied by the environment instead: the canary refuses to run
  // outside `test`, and `db:test:up` / `db:test:down` create and destroy that
  // database around the run, so the rows never outlive it.
  await pool.end().catch(() => undefined);
}

await expectFailClosed({
  cwd: new URL('..', import.meta.url),
  entry: 'dist/main.js',
  env: { APP_ENV: 'production' },
  what: 'Worker',
});

const preserved = {
  ALLOW_SYNTHETIC_PROVIDERS: process.env.ALLOW_SYNTHETIC_PROVIDERS,
  APP_ENV: process.env.APP_ENV,
  DATA_MODE: process.env.DATA_MODE,
  OBJECT_STORAGE_GRANT_KEY: process.env.OBJECT_STORAGE_GRANT_KEY,
  ONLINE_TEST_DATABASE_URL: process.env.ONLINE_TEST_DATABASE_URL,
  ONLINE_TEST_SUPABASE_PROJECT_REF: process.env.ONLINE_TEST_SUPABASE_PROJECT_REF,
  OTP_HASH_KEY: process.env.OTP_HASH_KEY,
  PAYMENT_WEBHOOK_KEY: process.env.PAYMENT_WEBHOOK_KEY,
  PROVIDER_CLEARING_ACCOUNT_REFERENCE: process.env.PROVIDER_CLEARING_ACCOUNT_REFERENCE,
  RELEASE_VERSION: process.env.RELEASE_VERSION,
  SESSION_TOKEN_HASH_KEY: process.env.SESSION_TOKEN_HASH_KEY,
};
try {
  process.env.APP_ENV = 'online-test';
  process.env.DATA_MODE = 'synthetic';
  // Environments above `local` must name their synthetic providers and have their
  // secret material injected rather than fall back to values committed in this
  // repository. These stand in for the secret manager; nothing here opens a
  // connection or contacts a provider.
  process.env.ALLOW_SYNTHETIC_PROVIDERS = 'synthetic-testing-only';
  for (const key of [
    'OBJECT_STORAGE_GRANT_KEY',
    'OTP_HASH_KEY',
    'PAYMENT_WEBHOOK_KEY',
    'SESSION_TOKEN_HASH_KEY',
  ]) {
    process.env[key] =
      `synthetic-smoke-${key.toLowerCase().replaceAll('_', '-')}-${'0'.repeat(32)}`;
  }
  process.env.PROVIDER_CLEARING_ACCOUNT_REFERENCE = 'SYNTH-CLEARING-ACCOUNT';
  // The shared loader resolves a connection string for every environment. No
  // connection is opened here: the assertions below only exercise the
  // environment, data-mode and release-version rules.
  process.env.ONLINE_TEST_SUPABASE_PROJECT_REF = 'a'.repeat(20);
  process.env.ONLINE_TEST_DATABASE_URL = `postgresql://postgres:synthetic@db.${'a'.repeat(20)}.supabase.co:5432/postgres?sslmode=verify-full`;
  process.env.RELEASE_VERSION = 'a'.repeat(40);
  const online = loadRuntimeConfig();
  if (
    online.environment !== 'online-test' ||
    online.dataMode !== 'synthetic' ||
    online.version !== 'a'.repeat(40)
  ) {
    throw new Error('Worker rejected the safe online-test configuration');
  }

  process.env.DATA_MODE = 'real';
  let rejectedRealData = false;
  try {
    loadRuntimeConfig();
  } catch {
    rejectedRealData = true;
  }
  if (!rejectedRealData) throw new Error('Worker accepted real data in online-test');

  process.env.DATA_MODE = 'synthetic';
  delete process.env.RELEASE_VERSION;
  let rejectedUnversioned = false;
  try {
    loadRuntimeConfig();
  } catch {
    rejectedUnversioned = true;
  }
  if (!rejectedUnversioned) throw new Error('Worker accepted an unversioned online-test release');
} finally {
  for (const [key, value] of Object.entries(preserved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
}
