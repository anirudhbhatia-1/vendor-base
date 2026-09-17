import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedMethods, isAllowedOrigin, parseConfiguredOrigins } from './cors.js';

test('the DELETE surface is reachable from a browser', () => {
  assert.ok(allowedMethods.includes('DELETE'));
});

test('loopback development clients are always allowed', () => {
  assert.equal(isAllowedOrigin('http://127.0.0.1:3100', []), true);
  assert.equal(isAllowedOrigin('http://localhost:3103', []), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:3104', []), false);
});

test('a configured deployment origin is allowed, an unrelated one is not', () => {
  const configured = parseConfiguredOrigins('https://customer.example.pages.dev');
  assert.deepEqual(configured, ['https://customer.example.pages.dev']);
  assert.equal(isAllowedOrigin('https://customer.example.pages.dev', configured), true);
  assert.equal(isAllowedOrigin('https://attacker.example', configured), false);
});

test('wildcards and non-origin entries are rejected', () => {
  assert.throws(() => parseConfiguredOrigins('*'), /wildcard/);
  assert.throws(() => parseConfiguredOrigins('https://example.com/app'), /origin only/);
  assert.throws(() => parseConfiguredOrigins('ftp://example.com'), /http or https/);
  assert.throws(() => parseConfiguredOrigins('not-a-url'), /not a URL/);
});

test('an empty configuration allows only the loopback clients', () => {
  assert.deepEqual(parseConfiguredOrigins(undefined), []);
  assert.deepEqual(parseConfiguredOrigins(''), []);
});
