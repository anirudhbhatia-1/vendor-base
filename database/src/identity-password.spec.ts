import assert from 'node:assert/strict';
import { scrypt as scryptSync } from 'node:crypto';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import {
  IdentityPasswordService,
  PasswordAuthenticationError,
  PasswordInputError,
  PasswordRateLimitedError,
} from './identity-password.js';

// A test-only scrypt promisification with the same parameters the service uses,
// so we can assert the invariants (deterministic hashing, salt sensitivity)
// without needing a real database pool.
const scrypt = promisify(scryptSync) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number },
) => Promise<Buffer>;

describe('IdentityPasswordService construction', () => {
  it('rejects a hash key shorter than 32 characters', () => {
    assert.throws(
      () =>
        new IdentityPasswordService({
          connection_string: 'postgresql://x/x',
          hash_key: 'tiny',
        }),
      /at least 32 characters/,
    );
  });

  it('accepts a hash key of exactly 32 characters', () => {
    const svc = new IdentityPasswordService({
      connection_string: 'postgresql://x/x',
      hash_key: 'a'.repeat(32),
    });
    assert.ok(svc);
    void svc.close(); // fire-and-forget; no pool activity happened yet
  });
});

describe('scrypt hashing invariants (mirrors IdentityPasswordService)', () => {
  const N = 16_384;
  const r = 8;
  const p = 1;
  const keylen = 64;

  it('produces the same hash for the same password + salt', async () => {
    const salt = Buffer.from('deterministic-salt-32-bytes-value', 'utf8');
    const a = await scrypt('correct horse battery staple', salt, keylen, { N, r, p });
    const b = await scrypt('correct horse battery staple', salt, keylen, { N, r, p });
    assert.deepEqual(a, b);
  });

  it('produces different hashes for different passwords with the same salt', async () => {
    const salt = Buffer.from('deterministic-salt-32-bytes-value', 'utf8');
    const a = await scrypt('correct horse battery staple', salt, keylen, { N, r, p });
    const b = await scrypt('correct horse battery stapl3', salt, keylen, { N, r, p });
    assert.notDeepEqual(a, b);
  });

  it('produces different hashes for the same password with different salts', async () => {
    const s1 = Buffer.from('salt-one-here-is-32-bytes-value-x', 'utf8');
    const s2 = Buffer.from('salt-two-here-is-32-bytes-value-y', 'utf8');
    const a = await scrypt('correct horse battery staple', s1, keylen, { N, r, p });
    const b = await scrypt('correct horse battery staple', s2, keylen, { N, r, p });
    assert.notDeepEqual(a, b);
  });

  it('produces a hash of exactly keylen bytes', async () => {
    const salt = Buffer.from('deterministic-salt-32-bytes-value', 'utf8');
    const hash = await scrypt('correct horse battery staple', salt, keylen, { N, r, p });
    assert.equal(hash.length, keylen);
  });
});

describe('error taxonomy', () => {
  it('input error carries the INVALID_ARGUMENT code', () => {
    const err = new PasswordInputError('bad');
    assert.equal(err.code, 'INVALID_ARGUMENT');
  });

  it('authentication error carries the UNAUTHENTICATED code', () => {
    const err = new PasswordAuthenticationError('bad');
    assert.equal(err.code, 'UNAUTHENTICATED');
  });

  it('rate-limit error carries the RATE_LIMITED code', () => {
    const err = new PasswordRateLimitedError('bad');
    assert.equal(err.code, 'RATE_LIMITED');
  });
});
