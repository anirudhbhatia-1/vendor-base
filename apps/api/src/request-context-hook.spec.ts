import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { isUuidV7 } from '@neighbourhood-store/domain-types';
import { installRequestContextHook, parseIngressRequestIdMode } from './request-context-hook.js';

const V4_FROM_INGRESS = '550e8400-e29b-41d4-a716-446655440000';
const V7_FROM_CLIENT = '01a09f5f-2547-7c63-9c94-10ccc884d8cd';

async function app(mode: 'reject' | 'replace') {
  const instance = Fastify();
  installRequestContextHook(instance, { ingressRequestIdMode: mode });
  instance.get('/probe', async (_request, reply) => reply.send({ ok: true }));
  await instance.ready();
  return instance;
}

test('by default a request id that is not a UUIDv7 is refused', async () => {
  const instance = await app('reject');
  const response = await instance.inject({
    url: '/probe',
    headers: { 'x-request-id': V4_FROM_INGRESS },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.field_errors[0].code, 'INVALID_REQUEST_ID');
  await instance.close();
});

test('behind an ingress that stamps its own id, the API mints one instead of refusing', async () => {
  const instance = await app('replace');
  const response = await instance.inject({
    url: '/probe',
    headers: { 'x-request-id': V4_FROM_INGRESS },
  });
  assert.equal(response.statusCode, 200);
  const issued = response.headers['x-request-id'];
  assert.ok(typeof issued === 'string' && isUuidV7(issued));
  assert.notEqual(issued, V4_FROM_INGRESS);
  await instance.close();
});

test("replace mode still threads a client's own UUIDv7 through", async () => {
  const instance = await app('replace');
  const response = await instance.inject({
    url: '/probe',
    headers: { 'x-request-id': V7_FROM_CLIENT },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-request-id'], V7_FROM_CLIENT);
  await instance.close();
});

test('the mode is read strictly from configuration', () => {
  assert.equal(parseIngressRequestIdMode(undefined), 'reject');
  assert.equal(parseIngressRequestIdMode(''), 'reject');
  assert.equal(parseIngressRequestIdMode('replace'), 'replace');
  assert.throws(() => parseIngressRequestIdMode('lenient'));
});
