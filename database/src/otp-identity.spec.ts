import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalisePhoneIdentifier } from './otp-identity.js';

const PHONE_PATTERN = /^(?:\+[1-9][0-9]{7,14}|SYNTH-PHONE-[A-Z0-9][A-Z0-9-]{2,47})$/;

test('E.164 numbers keep their separators stripped', () => {
  assert.equal(normalisePhoneIdentifier(' +91 98765-43210 '), '+919876543210');
  assert.equal(normalisePhoneIdentifier('+91 (98765) 43210'), '+919876543210');
  assert.ok(PHONE_PATTERN.test(normalisePhoneIdentifier('+91 98765-43210')));
});

test('a synthetic identifier keeps the hyphens its own pattern requires', () => {
  // Stripping separators unconditionally turned SYNTH-PHONE-ADMIN-001 into
  // SYNTHPHONEADMIN001, which fails the pattern that admits the synthetic form.
  // The effect was that no seeded synthetic identity — admin, vendor, partner
  // or customer — could request an OTP at all.
  const normalised = normalisePhoneIdentifier('synth-phone-admin-001');
  assert.equal(normalised, 'SYNTH-PHONE-ADMIN-001');
  assert.ok(PHONE_PATTERN.test(normalised), 'the normalised value satisfies the accepted pattern');
});

test('whitespace and brackets are still removed from a synthetic identifier', () => {
  assert.equal(normalisePhoneIdentifier(' SYNTH-PHONE-VENDOR-9 '), 'SYNTH-PHONE-VENDOR-9');
});
