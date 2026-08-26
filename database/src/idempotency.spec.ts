import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalRequestHash, canonicalRequestJson } from './idempotency.js';

describe('canonical request encoding', () => {
  it('sorts object keys recursively while preserving array order', () => {
    const left = { quantity: 2, item: { unit: 'kg', name: 'Tomato' }, tags: ['fresh', 'red'] };
    const right = { tags: ['fresh', 'red'], item: { name: 'Tomato', unit: 'kg' }, quantity: 2 };

    assert.equal(canonicalRequestJson(left), canonicalRequestJson(right));
    assert.equal(canonicalRequestHash(left), canonicalRequestHash(right));
    assert.notEqual(
      canonicalRequestHash(left),
      canonicalRequestHash({ ...left, tags: ['red', 'fresh'] }),
    );
  });

  it('normalizes negative zero', () => {
    assert.equal(canonicalRequestJson({ value: -0 }), '{"value":0}');
  });

  it('rejects values that cannot be represented safely as JSON', () => {
    assert.throws(() => canonicalRequestJson({ value: undefined }), /only JSON values/);
    assert.throws(() => canonicalRequestJson({ value: Number.POSITIVE_INFINITY }), /finite/);
    assert.throws(() => canonicalRequestJson(new Date()), /plain JSON objects/);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => canonicalRequestJson(cyclic), /must not contain cycles/);
  });
});
