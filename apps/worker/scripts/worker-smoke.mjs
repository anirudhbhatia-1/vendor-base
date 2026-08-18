import { spawn } from 'node:child_process';
import { loadRuntimeConfig } from '../dist/runtime-config.js';

const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    APP_ENV: 'test',
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

async function waitForReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (output.includes('"event":"worker.ready"')) return;
    if (child.exitCode !== null) throw new Error(`Worker exited early. Output: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for worker readiness. Output: ${output}`);
}

try {
  await waitForReady();
  child.kill('SIGTERM');
  const result = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0 && result.signal !== 'SIGTERM') {
    throw new Error(`Worker exited unexpectedly. Output: ${output}`);
  }
  if (!output.includes('"event":"worker.stopped"')) throw new Error('Graceful stop was not logged');
  if (output.includes('SYNTHETIC_SENTINEL_2_3'))
    throw new Error('Worker logged an environment secret');
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
  throw new Error('Worker did not fail closed for APP_ENV=production');
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
