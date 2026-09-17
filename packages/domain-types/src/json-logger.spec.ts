import assert from 'node:assert/strict';
import test from 'node:test';
import { JsonLogger } from './json-logger.js';
import { createRequestContext } from './request-context.js';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const logger = new JsonLogger('spec-service', () => createRequestContext({}), {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { logger, out, err };
}

test('a log line carries the service, the level, the request context and redacted metadata', () => {
  const { logger, out } = capture();
  logger.event('thing.happened', { phone_number: '+919999999999', count: 2 });
  const line = JSON.parse(out[0] ?? '{}') as Record<string, unknown>;
  assert.equal(line['service'], 'spec-service');
  assert.equal(line['level'], 'info');
  assert.equal(line['event'], 'thing.happened');
  assert.equal(line['count'], 2);
  assert.notEqual(line['phone_number'], '+919999999999');
  assert.equal(typeof line['request_id'], 'string');
  assert.equal(typeof line['correlation_id'], 'string');
});

test('errors go to stderr with their name, message and code', () => {
  const { logger, out, err } = capture();
  const failure = Object.assign(new Error('boom'), { code: 'ECONNRESET' });
  logger.error(failure, 'operations');
  assert.equal(out.length, 0);
  const line = JSON.parse(err[0] ?? '{}') as Record<string, unknown>;
  assert.equal(line['level'], 'error');
  assert.equal(line['event'], 'Error: boom');
  assert.equal(line['error_code'], 'ECONNRESET');
  assert.equal(line['context'], 'operations');
});
