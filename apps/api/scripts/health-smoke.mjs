import { spawn } from 'node:child_process';

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

async function waitForHealth(path) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.ok) return response.json();
    } catch {
      // Startup connection refusal is expected until Fastify begins listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${path}. Output: ${output}`);
}

try {
  const live = await waitForHealth('/health/live');
  const ready = await waitForHealth('/health/ready');
  if (live.status !== 'ok' || live.environment !== 'test') throw new Error('Invalid liveness body');
  if (ready.status !== 'ready' || ready.production_ready !== false) {
    throw new Error('Invalid readiness body');
  }
  child.kill('SIGTERM');
  const result = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0 && result.signal !== 'SIGTERM') {
    throw new Error(`API exited unexpectedly. Output: ${output}`);
  }
  if (!output.includes('"event":"api.stopped"')) throw new Error('Graceful stop was not logged');
  if (output.includes('SYNTHETIC_SENTINEL_2_3'))
    throw new Error('API logged an environment secret');
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
