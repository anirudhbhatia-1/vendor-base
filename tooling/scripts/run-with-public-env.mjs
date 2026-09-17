import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { constants as osConstants } from 'node:os';
import { spawn } from 'node:child_process';

/**
 * Runs a PWA command with the public environment values of an operator env file.
 *
 * Only `NEXT_PUBLIC_*` keys and the non-secret CUSTOMER_PWA_ORIGIN are forwarded. Server-only values such as
 * `SUPABASE_SERVICE_ROLE_KEY` and database URLs never reach the Next.js process,
 * so they cannot be inlined into a client bundle.
 *
 * Usage: node tooling/scripts/run-with-public-env.mjs <env-file> <command> [args...]
 */

const [envFile, command, ...commandArguments] = process.argv.slice(2);
if (!envFile || !command) {
  console.error('usage: run-with-public-env.mjs <env-file> <command> [args...]');
  process.exit(1);
}

const resolvedEnvFile = path.resolve(envFile);
if (!fs.existsSync(resolvedEnvFile)) {
  console.error(
    `${resolvedEnvFile} does not exist. Copy the matching env.example beside it and fill the ignored file.`,
  );
  process.exit(1);
}

export function readPublicValues(text) {
  const values = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key.startsWith('NEXT_PUBLIC_') && key !== 'CUSTOMER_PWA_ORIGIN') continue;
    const value = line.slice(separator + 1).trim();
    values[key] = value.replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const publicValues = readPublicValues(fs.readFileSync(resolvedEnvFile, 'utf8'));
const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].filter(
  (key) => !publicValues[key],
);
if (missing.length > 0) {
  console.error(`${resolvedEnvFile} is missing ${missing.join(' and ')}.`);
  process.exit(1);
}

const child = spawn(command, commandArguments, {
  env: { ...process.env, ...publicValues },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});
let forcedStop;
let forwardedSignal;

const forward = (signal) => {
  if (forwardedSignal || child.exitCode !== null) return;
  forwardedSignal = signal;
  child.kill(signal);
  forcedStop = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 5_000);
  forcedStop.unref();
};

for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
  process.once(signal, () => forward(signal));
}
child.once('error', (error) => {
  throw error;
});
child.once('exit', (code, signal) => {
  if (forcedStop) clearTimeout(forcedStop);
  if (code !== null) process.exit(code);
  const signalNumber = signal ? osConstants.signals[signal] : undefined;
  process.exit(signalNumber === undefined ? 1 : 128 + signalNumber);
});
