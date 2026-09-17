import { expectFailClosed, spawnCaptured } from '../../../tooling/scripts/smoke-support.mjs';
import { createUuidV7, isUuidV7 } from '@neighbourhood-store/domain-types';
import { loadRuntimeConfig } from '../dist/runtime-config.js';

const port = 39_101;
const { child, captured } = spawnCaptured({
  cwd: new URL('..', import.meta.url),
  entry: 'dist/main.js',
  env: {
    APP_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: String(port),
    UNUSED_SECRET_SENTINEL: 'SYNTHETIC_SENTINEL_2_3',
  },
});

async function waitForHealth(path, headers = {}) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
      if (response.ok) return { response, body: await response.json() };
    } catch {
      // Startup connection refusal is expected until Fastify begins listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${path}. Output: ${captured.text}`);
}

try {
  const liveResult = await waitForHealth('/health/live');
  const readyResult = await waitForHealth('/health/ready');
  const live = liveResult.body;
  const ready = readyResult.body;
  if (live.status !== 'ok' || live.environment !== 'test') throw new Error('Invalid liveness body');
  if (ready.status !== 'ready' || ready.production_ready !== false) {
    throw new Error('Invalid readiness body');
  }
  for (const result of [liveResult, readyResult]) {
    const responseRequestId = result.response.headers.get('x-request-id');
    if (
      !responseRequestId ||
      !isUuidV7(responseRequestId) ||
      result.body.request_id !== responseRequestId
    ) {
      throw new Error('API did not return the generated request reference safely');
    }
    if (
      !/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(
        result.response.headers.get('traceparent') ?? '',
      )
    ) {
      throw new Error('API did not return a valid trace context');
    }
  }

  // Broker and consumer health, against the real Valkey the test stack runs.
  //
  // `/health/ready` used to report `queue: 'ready'` from the presence of two
  // PostgreSQL tables, so a deployment with the broker stopped and no worker
  // running looked healthy. These assertions are what make that impossible to
  // reintroduce: the broker state has to come from an actual connection, and
  // consumer liveness from the durable heartbeat rather than the worker's stdout.
  const asyncHealth = ready.async_processing;
  if (!asyncHealth) throw new Error('Readiness did not report async processing health');
  if (asyncHealth.broker !== 'ready') {
    throw new Error(
      `Broker check did not reach the test Valkey (got ${asyncHealth.broker}). ` +
        'Start the stack with `pnpm db:test:up`.',
    );
  }
  // Consumer state must agree with the count it is derived from.
  //
  // This deliberately does not assert "no worker is running": `pnpm -r
  // test:integration` runs the package smokes in parallel, so the worker's own
  // smoke may legitimately have one alive. What must hold either way is that
  // readiness never claims a consumer it cannot count -- which is exactly the
  // failure mode that let table presence stand in for a live worker.
  const workerStateAgrees =
    asyncHealth.workers === 'ready'
      ? asyncHealth.live_worker_count > 0
      : asyncHealth.live_worker_count === 0;
  if (!workerStateAgrees) {
    throw new Error(
      `Readiness reported workers=${asyncHealth.workers} with ` +
        `live_worker_count=${asyncHealth.live_worker_count}`,
    );
  }
  if (!['ready', 'none_live', 'unknown'].includes(asyncHealth.workers)) {
    throw new Error(`Readiness reported an unknown consumer state: ${asyncHealth.workers}`);
  }
  if (ready.checks.job_schema !== 'ready') throw new Error('Job schema check did not report ready');
  if ('queue' in ready.checks) {
    throw new Error('Readiness still reports a `queue` check that means table presence');
  }

  const suppliedRequestId = createUuidV7();
  const suppliedResult = await waitForHealth('/health/live', { 'x-request-id': suppliedRequestId });
  if (
    suppliedResult.response.headers.get('x-request-id') !== suppliedRequestId ||
    suppliedResult.body.request_id !== suppliedRequestId
  ) {
    throw new Error('API did not preserve a valid supplied request ID');
  }

  const invalidResponse = await fetch(`http://127.0.0.1:${port}/health/live`, {
    headers: { 'x-request-id': 'unsafe-client-value' },
  });
  const invalidBody = await invalidResponse.json();
  const fallbackRequestId = invalidResponse.headers.get('x-request-id');
  if (
    invalidResponse.status !== 400 ||
    invalidBody.error?.code !== 'INVALID_ARGUMENT' ||
    invalidBody.error?.request_id !== fallbackRequestId ||
    !fallbackRequestId ||
    !isUuidV7(fallbackRequestId)
  ) {
    throw new Error('API did not reject an invalid request ID with a safe fallback reference');
  }

  // A stopped broker is reported, and does NOT take the API out of rotation.
  // Failing readiness here would remove the pods needed to drain the backlog once
  // the broker returns, for a fault that leaves every synchronous request working.
  const deadBrokerPort = 39_599;
  const { child: deadBrokerChild } = spawnCaptured({
    cwd: new URL('..', import.meta.url),
    entry: 'dist/main.js',
    env: {
      APP_ENV: 'test',
      API_HOST: '127.0.0.1',
      API_PORT: String(port + 1),
      UNUSED_SECRET_SENTINEL: 'SYNTHETIC_SENTINEL_2_3',
      VALKEY_URL: `redis://127.0.0.1:${deadBrokerPort}`,
    },
  });
  try {
    const deadline = Date.now() + 15_000;
    let degraded;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port + 1}/health/ready`);
        degraded = { status: response.status, body: await response.json() };
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!degraded) throw new Error('Timed out waiting for the dead-broker API');
    if (degraded.body.async_processing?.broker !== 'unreachable') {
      throw new Error(
        `An unreachable broker was reported as ${degraded.body.async_processing?.broker}`,
      );
    }
    if (degraded.status !== 200 || degraded.body.status !== 'ready') {
      throw new Error('A broker outage took the API out of rotation, which drops drain capacity');
    }
  } finally {
    deadBrokerChild.kill('SIGTERM');
  }

  const missingResponse = await fetch(`http://127.0.0.1:${port}/missing-route`);
  const missingBody = await missingResponse.json();
  if (
    missingResponse.status !== 404 ||
    missingBody.error?.code !== 'RESOURCE_NOT_FOUND' ||
    missingBody.error?.request_id !== missingResponse.headers.get('x-request-id')
  ) {
    throw new Error('API exception responses did not preserve the safe request reference');
  }

  const otpResponse = await fetch(`http://127.0.0.1:${port}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '123456' }),
  });
  const otpBody = await otpResponse.json();
  if (
    otpResponse.status !== 400 ||
    otpBody.error?.code !== 'INVALID_ARGUMENT' ||
    otpBody.error?.request_id !== otpResponse.headers.get('x-request-id')
  ) {
    throw new Error('OTP route did not use the standard safe validation boundary');
  }

  const refreshResponse = await fetch(`http://127.0.0.1:${port}/auth/sessions/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const refreshBody = await refreshResponse.json();
  if (
    refreshResponse.status !== 400 ||
    refreshBody.error?.code !== 'INVALID_ARGUMENT' ||
    refreshBody.error?.request_id !== refreshResponse.headers.get('x-request-id')
  ) {
    throw new Error('Session refresh route did not use the safe validation boundary');
  }

  const sessionsResponse = await fetch(`http://127.0.0.1:${port}/auth/sessions`);
  const sessionsBody = await sessionsResponse.json();
  if (
    sessionsResponse.status !== 401 ||
    sessionsBody.error?.code !== 'UNAUTHENTICATED' ||
    sessionsBody.error?.request_id !== sessionsResponse.headers.get('x-request-id')
  ) {
    throw new Error('Session listing route did not reject missing credentials safely');
  }

  const customerIdentityResponse = await fetch(`http://127.0.0.1:${port}/auth/customer/me`);
  const customerIdentityBody = await customerIdentityResponse.json();
  if (
    customerIdentityResponse.status !== 401 ||
    customerIdentityBody.error?.code !== 'UNAUTHENTICATED' ||
    customerIdentityBody.error?.request_id !== customerIdentityResponse.headers.get('x-request-id')
  ) {
    throw new Error('Protected customer boundary did not reject missing credentials safely');
  }

  const customerEnrolResponse = await fetch(`http://127.0.0.1:${port}/auth/customer/enrol`, {
    method: 'POST',
  });
  const customerEnrolBody = await customerEnrolResponse.json();
  if (
    customerEnrolResponse.status !== 401 ||
    customerEnrolBody.error?.code !== 'UNAUTHENTICATED' ||
    customerEnrolBody.error?.request_id !== customerEnrolResponse.headers.get('x-request-id')
  ) {
    throw new Error('Customer enrolment boundary did not reject missing credentials safely');
  }

  const onboardingResponse = await fetch(
    `http://127.0.0.1:${port}/vendor/onboarding/applications`,
    { method: 'POST' },
  );
  const onboardingBody = await onboardingResponse.json();
  if (
    onboardingResponse.status !== 401 ||
    onboardingBody.error?.code !== 'UNAUTHENTICATED' ||
    onboardingBody.error?.request_id !== onboardingResponse.headers.get('x-request-id')
  ) {
    throw new Error('Vendor onboarding entry did not reject a missing session safely');
  }

  const reviewResponse = await fetch(
    `http://127.0.0.1:${port}/admin/vendor-onboarding/${createUuidV7()}`,
  );
  const reviewBody = await reviewResponse.json();
  if (
    reviewResponse.status !== 401 ||
    reviewBody.error?.code !== 'UNAUTHENTICATED' ||
    reviewBody.error?.request_id !== reviewResponse.headers.get('x-request-id')
  ) {
    throw new Error('Vendor onboarding review did not reject missing admin credentials safely');
  }

  const publicationResponse = await fetch(`http://127.0.0.1:${port}/admin/vendor-publications`);
  const publicationBody = await publicationResponse.json();
  if (
    publicationResponse.status !== 401 ||
    publicationBody.error?.code !== 'UNAUTHENTICATED' ||
    publicationBody.error?.request_id !== publicationResponse.headers.get('x-request-id')
  ) {
    throw new Error('Vendor publication pipeline did not reject missing admin credentials safely');
  }

  const inventoryResponse = await fetch(
    `http://127.0.0.1:${port}/vendor/locations/${createUuidV7()}/inventory`,
  );
  const inventoryBody = await inventoryResponse.json();
  if (
    inventoryResponse.status !== 401 ||
    inventoryBody.error?.code !== 'UNAUTHENTICATED' ||
    inventoryBody.error?.request_id !== inventoryResponse.headers.get('x-request-id')
  ) {
    throw new Error('Vendor inventory boundary did not reject missing credentials safely');
  }

  const assignmentResponse = await fetch(
    `http://127.0.0.1:${port}/partner/assignments/${createUuidV7()}`,
  );
  const assignmentBody = await assignmentResponse.json();
  if (
    assignmentResponse.status !== 401 ||
    assignmentBody.error?.code !== 'UNAUTHENTICATED' ||
    assignmentBody.error?.request_id !== assignmentResponse.headers.get('x-request-id')
  ) {
    throw new Error('Partner assignment boundary did not reject missing credentials safely');
  }

  child.kill('SIGTERM');
  const result = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0 && result.signal !== 'SIGTERM') {
    throw new Error(`API exited unexpectedly. Output: ${captured.text}`);
  }
  if (!captured.text.includes('"event":"api.stopped"'))
    throw new Error('Graceful stop was not logged');
  if (
    !captured.text.includes('"event":"http.request.completed"') ||
    !captured.text.includes('"request_id":')
  ) {
    throw new Error('Request completion logs did not include safe correlation context');
  }
  if (captured.text.includes('SYNTHETIC_SENTINEL_2_3'))
    throw new Error('API logged an environment secret');
  if (captured.text.includes('123456')) throw new Error('API logged OTP content');
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
}

await expectFailClosed({
  cwd: new URL('..', import.meta.url),
  entry: 'dist/main.js',
  env: { APP_ENV: 'production' },
  what: 'API',
});

const preserved = {
  ALLOW_SYNTHETIC_PROVIDERS: process.env.ALLOW_SYNTHETIC_PROVIDERS,
  APP_ENV: process.env.APP_ENV,
  DATA_MODE: process.env.DATA_MODE,
  OBJECT_STORAGE_GRANT_KEY: process.env.OBJECT_STORAGE_GRANT_KEY,
  OTP_HASH_KEY: process.env.OTP_HASH_KEY,
  PAYMENT_WEBHOOK_KEY: process.env.PAYMENT_WEBHOOK_KEY,
  PROVIDER_CLEARING_ACCOUNT_REFERENCE: process.env.PROVIDER_CLEARING_ACCOUNT_REFERENCE,
  SESSION_TOKEN_HASH_KEY: process.env.SESSION_TOKEN_HASH_KEY,
  ONLINE_TEST_DATABASE_URL: process.env.ONLINE_TEST_DATABASE_URL,
  ONLINE_TEST_SUPABASE_PROJECT_REF: process.env.ONLINE_TEST_SUPABASE_PROJECT_REF,
  RELEASE_VERSION: process.env.RELEASE_VERSION,
};
try {
  process.env.APP_ENV = 'online-test';
  process.env.DATA_MODE = 'synthetic';
  // Non-local environments must now name their synthetic providers explicitly
  // rather than fall back to the filesystem object-storage adapter, which is
  // local-only. This block asserts a *knowingly synthetic* online-test
  // configuration is accepted, so the acknowledgement is exactly what it should
  // carry -- without it the loader refuses, which is the gate working.
  process.env.ALLOW_SYNTHETIC_PROVIDERS = 'synthetic-testing-only';
  // Every environment above `local` must have its secret material injected rather
  // than fall back to values committed in this repository. These are synthetic
  // test-only values standing in for the secret manager; the assertions below
  // exercise environment, data-mode and release-version rules, and open no
  // connection and contact no provider.
  for (const key of [
    'OBJECT_STORAGE_GRANT_KEY',
    'OTP_HASH_KEY',
    'PAYMENT_WEBHOOK_KEY',
    'SESSION_TOKEN_HASH_KEY',
  ]) {
    // Padded to the minimum length the policy requires; short values are refused.
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
    throw new Error('API rejected the safe online-test configuration');
  }

  process.env.DATA_MODE = 'real';
  let rejectedRealData = false;
  try {
    loadRuntimeConfig();
  } catch {
    rejectedRealData = true;
  }
  if (!rejectedRealData) throw new Error('API accepted real data in online-test');

  process.env.DATA_MODE = 'synthetic';
  delete process.env.RELEASE_VERSION;
  let rejectedUnversioned = false;
  try {
    loadRuntimeConfig();
  } catch {
    rejectedUnversioned = true;
  }
  if (!rejectedUnversioned) throw new Error('API accepted an unversioned online-test release');
} finally {
  for (const [key, value] of Object.entries(preserved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
}
