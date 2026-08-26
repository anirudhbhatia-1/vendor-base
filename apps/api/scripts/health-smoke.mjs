import { spawn } from 'node:child_process';
import { createUuidV7, isUuidV7 } from '@neighbourhood-store/domain-types';
import { loadRuntimeConfig } from '../dist/runtime-config.js';

const port = 39_101;
const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    APP_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: String(port),
    UNUSED_SECRET_SENTINEL: 'SYNTHETIC_SENTINEL_2_3',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  output += chunk;
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
  throw new Error(`Timed out waiting for ${path}. Output: ${output}`);
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
    throw new Error(`API exited unexpectedly. Output: ${output}`);
  }
  if (!output.includes('"event":"api.stopped"')) throw new Error('Graceful stop was not logged');
  if (!output.includes('"event":"http.request.completed"') || !output.includes('"request_id":')) {
    throw new Error('Request completion logs did not include safe correlation context');
  }
  if (output.includes('SYNTHETIC_SENTINEL_2_3'))
    throw new Error('API logged an environment secret');
  if (output.includes('123456')) throw new Error('API logged OTP content');
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
}

const rejected = spawn(process.execPath, ['dist/main.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, APP_ENV: 'production' },
  stdio: 'ignore',
});
const rejectedResult = await new Promise((resolve) => {
  rejected.once('exit', (code, signal) => resolve({ code, signal }));
});
if (rejectedResult.code === 0 || rejectedResult.signal !== null) {
  throw new Error('API did not fail closed for APP_ENV=production');
}

const preserved = {
  APP_ENV: process.env.APP_ENV,
  DATA_MODE: process.env.DATA_MODE,
  RELEASE_VERSION: process.env.RELEASE_VERSION,
};
try {
  process.env.APP_ENV = 'online-test';
  process.env.DATA_MODE = 'synthetic';
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
