import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { AdminLocaleController, LocaleController } from './locale.controller.js';

function authorization(method: keyof LocaleController): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, LocaleController.prototype[method]) as
    AuthorizationRequirement | undefined;
}

test('the locale bundle read is intentionally public (no authorization requirement)', () => {
  // A client must be able to hydrate its label set before sign-in.
  assert.equal(authorization('bundle'), undefined);
  const exposed = Object.getOwnPropertyNames(LocaleController.prototype).filter(
    (name) => name !== 'constructor',
  );
  assert.deepEqual(exposed, ['bundle']);
});

test('locale registry writes and coverage are exposed only through the scoped admin controller', () => {
  for (const method of ['coverage', 'key', 'translation'] as const) {
    const requirement = Reflect.getMetadata(
      AUTHORIZATION_REQUIREMENT,
      AdminLocaleController.prototype[method],
    ) as AuthorizationRequirement;
    assert.equal(requirement.capability, 'admin.locale.manage');
    assert.deepEqual(requirement.admin_scope, { kind: 'GLOBAL' });
  }
});
