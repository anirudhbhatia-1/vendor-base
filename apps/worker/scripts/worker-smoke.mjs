import { spawn } from 'node:child_process';

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
