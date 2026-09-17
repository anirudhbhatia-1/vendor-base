import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import {
  AUTHORIZATION_REQUIREMENT,
  SESSION_REQUIREMENT,
  type AuthorizationRequirement,
} from './authorization.js';
import { CustomerPreferencesController } from './customer-preferences.controller.js';

function authorization(
  method: keyof CustomerPreferencesController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    CustomerPreferencesController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

function sessionRequired(method: keyof CustomerPreferencesController): boolean | undefined {
  return Reflect.getMetadata(
    SESSION_REQUIREMENT,
    CustomerPreferencesController.prototype[method],
  ) as boolean | undefined;
}

test('enrol requires only a session (no role yet established at enrolment time)', () => {
  assert.equal(sessionRequired('enrol'), true);
  assert.equal(authorization('enrol'), undefined);
});

test('settings read uses customer.account.read capability', () => {
  assert.equal(authorization('settings')?.capability, 'customer.account.read');
});

test('write-path methods use customer.account.manage capability', () => {
  for (const method of ['updateProfile', 'recordConsent', 'setNotification'] as const) {
    assert.equal(
      authorization(method)?.capability,
      'customer.account.manage',
      `${method} capability`,
    );
  }
});

test('no preference route conceals resources — preferences belong only to the authenticated user', () => {
  for (const method of ['settings', 'updateProfile', 'recordConsent', 'setNotification'] as const) {
    assert.equal(authorization(method)?.conceal_resource, false, `${method} concealment`);
  }
});
