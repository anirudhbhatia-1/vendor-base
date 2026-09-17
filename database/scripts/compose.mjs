import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const composeFile = fileURLToPath(new URL('../../compose.yaml', import.meta.url));

function available(command, prefix) {
  const result = spawnSync(command, [...prefix, 'version'], { stdio: 'ignore' });
  return result.status === 0;
}

function runtime() {
  const requested = process.env.COMPOSE_RUNTIME;
  if (requested !== undefined) {
    if (requested !== 'podman' && requested !== 'docker') {
      throw new Error('COMPOSE_RUNTIME must be podman or docker when set');
    }
    if (!available(requested, ['compose'])) {
      throw new Error(`${requested} compose is unavailable`);
    }
    return { command: requested, prefix: ['compose'] };
  }
  if (available('podman', ['compose'])) return { command: 'podman', prefix: ['compose'] };
  if (available('docker', ['compose'])) return { command: 'docker', prefix: ['compose'] };
  throw new Error('Install and start Podman Desktop or Docker before running Compose commands');
}

function main() {
  const action = process.argv[2];
  const selected = runtime();
  const common = [...selected.prefix, '-f', composeFile];
  const actions = {
    config: [...common, 'config'],
    // The worker treats Valkey as an optional scale adapter, but BullMQ still
    // needs a reachable instance to open its queues, so each stack starts its
    // own: `valkey` on 6379 for local, `valkey-test` on 6380 for the disposable
    // test database used by the integration smokes.
    down: [...common, 'stop', 'database', 'valkey'],
    'test-down': [...common, '--profile', 'test', 'rm', '-f', '-s', 'database-test', 'valkey-test'],
    'test-up': [
      ...common,
      '--profile',
      'test',
      'up',
      '-d',
      '--wait',
      'database-test',
      'valkey-test',
    ],
    up: [...common, 'up', '-d', '--wait', 'database', 'valkey'],
  };
  const arguments_ = actions[action];
  if (!arguments_)
    throw new Error('Compose action must be config, up, down, test-up, or test-down');

  const result = spawnSync(selected.command, arguments_, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown Compose wrapper failure';
  process.stderr.write(`${JSON.stringify({ event: 'database.compose.failed', message })}\n`);
  process.exitCode = 1;
}
