import assert from 'node:assert/strict';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

/**
 * Runs a TypeScript service under Node watch mode without watching its entire
 * imported dependency graph on macOS and Windows.
 *
 * Node's default `--watch` follows every loaded module. In this workspace that
 * includes thousands of files under pnpm's store, so one API process can hold
 * more than 2,000 directory descriptors. `--watch-path` turns dependency-graph
 * watching off and limits restarts to the service source directory.
 *
 * Usage:
 *   node run-node-watch.mjs [--env-file <path>] --watch-path <path> <entrypoint>
 */

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

export function parseArguments(arguments_) {
  let envFile;
  let watchPath;
  let entrypoint;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--env-file') {
      envFile = arguments_[index + 1];
      index += 1;
    } else if (argument === '--watch-path') {
      watchPath = arguments_[index + 1];
      index += 1;
    } else if (!argument?.startsWith('--') && entrypoint === undefined) {
      entrypoint = argument;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? '<missing>'}`);
    }
  }

  if (!watchPath || !entrypoint) {
    throw new Error(
      'usage: run-node-watch.mjs [--env-file <path>] --watch-path <path> <entrypoint>',
    );
  }
  return { entrypoint, envFile, watchPath };
}

export function buildNodeArguments({ cwd, entrypoint, envFile, platform, watchPath }) {
  const resolvedEntrypoint = path.resolve(cwd, entrypoint);
  const resolvedWatchPath = path.resolve(cwd, watchPath);
  if (!inside(cwd, resolvedEntrypoint) || !inside(cwd, resolvedWatchPath)) {
    throw new Error('The watch path and entrypoint must remain inside the service directory.');
  }

  const nodeArguments = [];
  if (envFile) nodeArguments.push(`--env-file=${path.resolve(cwd, envFile)}`);
  nodeArguments.push('--import=tsx', '--watch-preserve-output');
  if (platform === 'darwin' || platform === 'win32') {
    nodeArguments.push(`--watch-path=${resolvedWatchPath}`);
  } else {
    // Node does not support --watch-path on Linux. Its inotify-backed default
    // does not consume one open directory descriptor for every imported file.
    nodeArguments.push('--watch');
  }
  nodeArguments.push(resolvedEntrypoint);
  return nodeArguments;
}

function runSelfTest() {
  const cwd = path.resolve('/workspace/apps/api');
  const parsed = parseArguments([
    '--env-file',
    '../../infrastructure/test.env',
    '--watch-path',
    'src',
    'src/main.ts',
  ]);
  const mac = buildNodeArguments({ ...parsed, cwd, platform: 'darwin' });
  assert.ok(mac.includes(`--watch-path=${path.join(cwd, 'src')}`));
  assert.ok(!mac.includes('--watch'));
  const linux = buildNodeArguments({ ...parsed, cwd, platform: 'linux' });
  assert.ok(linux.includes('--watch'));
  assert.throws(() =>
    buildNodeArguments({
      cwd,
      entrypoint: 'src/main.ts',
      platform: 'darwin',
      watchPath: '../../',
    }),
  );
  process.stdout.write('Scoped Node watch self-test passed.\n');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid watch arguments'}\n`);
    process.exit(1);
  }

  // Node's watch mode runs the service in a *grandchild* process. Signalling
  // this child alone therefore reached the supervisor and not the service, and
  // force-killing the supervisor orphaned a still-running service that kept the
  // port and kept writing to the terminal. Its own process group makes the
  // whole tree addressable as one.
  const ownGroup = process.platform !== 'win32';
  const child = spawn(
    process.execPath,
    buildNodeArguments({ ...parsed, cwd: process.cwd(), platform: process.platform }),
    { cwd: process.cwd(), detached: ownGroup, stdio: 'inherit' },
  );
  let forcedStop;
  let forwardedSignal;

  const signalTree = (signal) => {
    try {
      if (ownGroup) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // The tree is already gone, which is the outcome we wanted.
    }
  };

  const forward = (signal) => {
    if (forwardedSignal || child.exitCode !== null) return;
    forwardedSignal = signal;
    signalTree(signal);
    // Long enough for a worker to finish the queue job it is holding and close
    // its pools; the services bound their own shutdown well inside this.
    forcedStop = setTimeout(() => {
      if (child.exitCode === null) signalTree('SIGKILL');
    }, 10_000);
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
    // A stop we asked for is not a failure. Reporting 128+SIGKILL here turned
    // an ordinary Ctrl+C into ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL across the
    // whole dev stack, while every Next.js app beside it simply said "Done".
    if (forwardedSignal) process.exit(0);
    const signalNumber = signal ? osConstants.signals[signal] : undefined;
    process.exit(signalNumber === undefined ? 1 : 128 + signalNumber);
  });
}
