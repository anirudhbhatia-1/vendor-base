import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The digest a collection or delivery code is stored and checked as (8.6).
 *
 * A keyed hash: HMAC-SHA-256 under a key derived from the service's hash
 * material with its own domain label, so the key is not the sign-in OTP key
 * and a leaked digest is worthless without the material. Until audit run 54
 * the digest was plain SHA-256 of six digits, which is the six digits: a
 * million hashes take milliseconds.
 */
export function handoverCodeDigest(hashKey: string, code: string): string {
  if (hashKey.length < 16) {
    throw new Error('A hash key is required to issue or check a handover code');
  }
  const derived = createHmac('sha256', hashKey).update('handover-code').digest();
  return createHmac('sha256', derived).update(code).digest('hex');
}

/** Constant-time digest comparison; a mismatch takes as long as a match. */
export function handoverDigestsMatch(expected: string, attempted: string): boolean {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(attempted, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
