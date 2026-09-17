import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { FastifyReply } from 'fastify';
import { HealthController } from './health.controller.js';
import type { RuntimeConfig } from './runtime-config.js';

/** A configuration whose database cannot be reached, so readiness must fail closed. */
const unreachableConfig = {
  dataMode: 'synthetic',
  databaseUrl: 'postgresql://unreachable:unreachable@127.0.0.1:1/unreachable',
  environment: 'test',
  version: '0.0.0-test',
} as unknown as RuntimeConfig;

function recordingReply(): { reply: FastifyReply; statusCodes: number[] } {
  const statusCodes: number[] = [];
  const reply = {
    status(code: number) {
      statusCodes.push(code);
      return this;
    },
  } as unknown as FastifyReply;
  return { reply, statusCodes };
}

const controller = new HealthController(unreachableConfig);

after(async () => {
  await controller.onApplicationShutdown();
});

describe('HealthController', () => {
  it('reports the process as live even when dependencies are unreachable', () => {
    const live = controller.liveness();
    assert.equal(live.status, 'ok');
    assert.equal(live.environment, 'test');
  });

  it('answers readiness with 503 when the database is unreachable', async () => {
    const { reply, statusCodes } = recordingReply();
    const ready = await controller.readiness(reply);
    assert.deepEqual(statusCodes, [503]);
    assert.equal(ready.status, 'degraded');
    assert.equal(ready.checks.database, 'unavailable');
    assert.equal(ready.checks.job_schema, 'unavailable');
    // A database failure makes consumer health unknown, which is a different claim
    // from "no worker is running" -- the old shape could not express either.
    assert.equal(ready.async_processing.workers, 'unknown');
    assert.equal(ready.async_processing.broker, 'unreachable');
    assert.equal(ready.production_ready, false);
  });
});
