import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPublicReference,
  createRequestId,
  createUuidV7,
  isPublicReference,
  isUuidV7,
  parsePublicReference,
  parseRequestId,
  parseUuidV7,
  uuidV7Timestamp,
  type RandomBytes,
} from './identifiers.js';

function filledRandomBytes(value: number): RandomBytes {
  return (length) => new Uint8Array(length).fill(value);
}

test('creates a standards-shaped UUIDv7 with the supplied millisecond timestamp', () => {
  const nowMs = 1_723_456_789_012;
  const identifier = createUuidV7({ now_ms: nowMs, random_bytes: filledRandomBytes(0xaa) });

  assert.equal(isUuidV7(identifier), true);
  assert.equal(identifier[14], '7');
  assert.match(identifier.charAt(19), /[89ab]/);
  assert.equal(uuidV7Timestamp(identifier), nowMs);
  assert.equal(parseUuidV7(identifier.toUpperCase()), identifier);
});

test('rejects invalid UUID versions and creates branded request IDs', () => {
  assert.throws(() => parseUuidV7('550e8400-e29b-41d4-a716-446655440000'), TypeError);
  const requestId = createRequestId({ now_ms: 1000, random_bytes: filledRandomBytes(1) });
  assert.equal(parseRequestId(requestId), requestId);
});

test('creates non-sequential public references and detects checksum changes', () => {
  const reference = createPublicReference('ORD', (length) =>
    Uint8Array.from({ length }, (_, index) => index),
  );

  assert.equal(isPublicReference(reference), true);
  assert.equal(parsePublicReference(reference.toLowerCase()), reference);
  const replacement = reference.endsWith('2') ? '3' : '2';
  assert.equal(isPublicReference(`${reference.slice(0, -1)}${replacement}`), false);
  assert.throws(() => parsePublicReference('ORD-AAAAAA'), TypeError);
});

test('rejects malformed random sources', () => {
  assert.throws(() => createUuidV7({ random_bytes: () => new Uint8Array(3) }), /expected 16/);
  assert.throws(() => createPublicReference('CASE', filledRandomBytes(255)), /unbiased reference/);
});
