import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { loadRuntimeConfig } from './runtime-config.js';

const managedKeys = ['APP_ENV', 'WORKER_SHUTDOWN_GRACE_MS'] as const;
const original = new Map(managedKeys.map((key) => [key, process.env[key]] as const));

function restore(): void {
  for (const [key, value] of original) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
}

describe('worker shutdown grace', () => {
  afterEach(restore);

  it('defaults short so a watch-mode restart is not held up by a hung job', () => {
    process.env.APP_ENV = 'local';
    Reflect.deleteProperty(process.env, 'WORKER_SHUTDOWN_GRACE_MS');
    assert.equal(loadRuntimeConfig().shutdownGraceMs, 4_000);
  });

  it('accepts a deployment value that fits inside the container stop grace', () => {
    process.env.APP_ENV = 'local';
    // infrastructure/online-test/compose.yaml pairs 25s here with stop_grace_period: 30s.
    process.env.WORKER_SHUTDOWN_GRACE_MS = '25000';
    assert.equal(loadRuntimeConfig().shutdownGraceMs, 25_000);
  });

  it('refuses a grace too short to drain anything', () => {
    process.env.APP_ENV = 'local';
    process.env.WORKER_SHUTDOWN_GRACE_MS = '250';
    assert.throws(loadRuntimeConfig, /WORKER_SHUTDOWN_GRACE_MS/);
  });

  it('refuses a grace longer than any plausible stop grace', () => {
    process.env.APP_ENV = 'local';
    process.env.WORKER_SHUTDOWN_GRACE_MS = '600000';
    assert.throws(loadRuntimeConfig, /WORKER_SHUTDOWN_GRACE_MS/);
  });

  it('refuses a value that is not an integer', () => {
    process.env.APP_ENV = 'local';
    process.env.WORKER_SHUTDOWN_GRACE_MS = '4s';
    assert.throws(loadRuntimeConfig, /WORKER_SHUTDOWN_GRACE_MS/);
  });
});
