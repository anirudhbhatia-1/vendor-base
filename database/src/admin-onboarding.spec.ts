import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AdminOnboardingInputError, AdminOnboardingService } from './admin-onboarding.js';
import { IdentityPasswordService } from './identity-password.js';

const passwords = new IdentityPasswordService({
  connection_string: 'postgresql://x/x',
  hash_key: 'a'.repeat(32),
});

describe('AdminOnboardingService construction', () => {
  it('rejects a hash key shorter than 32 characters', () => {
    assert.throws(
      () =>
        new AdminOnboardingService({
          connection_string: 'postgresql://x/x',
          hash_key: 'tiny',
          password_service: passwords,
        }),
      AdminOnboardingInputError,
    );
  });

  it('accepts a valid hash key', () => {
    const svc = new AdminOnboardingService({
      connection_string: 'postgresql://x/x',
      hash_key: 'a'.repeat(32),
      password_service: passwords,
    });
    assert.ok(svc);
    void svc.close();
  });
});

describe('input validation shape', () => {
  it('AdminOnboardingInputError carries the INVALID_ARGUMENT code', () => {
    const err = new AdminOnboardingInputError('bad');
    assert.equal(err.code, 'INVALID_ARGUMENT');
  });
});

void passwords.close();
