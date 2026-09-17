import { spawn } from 'node:child_process';

/**
 * What the API and worker smokes both do to a built entry point.
 *
 * Each script spawned its process, captured both streams into one buffer, and
 * then spawned it again with `APP_ENV=production` to prove it fails closed --
 * in two copies that had already drifted by a stream encoding. The
 * fail-closed check in particular is a safety property (a service that starts
 * with production settings and synthetic secrets is the P0-01 finding), and it
 * should be one function with one definition of "failed closed".
 */

/** Starts `entry` in `cwd` with `env` merged over the parent's, capturing all output. */
export function spawnCaptured({ cwd, entry, env }) {
  const child = spawn(process.execPath, [entry], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const captured = { text: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    captured.text += chunk;
  });
  child.stderr.on('data', (chunk) => {
    captured.text += chunk;
  });
  return { child, captured };
}

/**
 * Failed closed means: exited on its own, with a non-zero code. A process that
 * was killed by a signal, or that started and served, did not refuse anything.
 */
export async function expectFailClosed({ cwd, entry, env, what }) {
  const rejected = spawn(process.execPath, [entry], {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
  const result = await new Promise((resolve) => {
    rejected.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (result.code === 0 || result.signal !== null) {
    throw new Error(`${what} did not fail closed for ${JSON.stringify(env)}`);
  }
}
