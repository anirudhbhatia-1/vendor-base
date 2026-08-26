import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { AdminCatalogueModerationController } from './catalogue-freshness-moderation.controller.js';

function requirement(method: keyof AdminCatalogueModerationController) {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    AdminCatalogueModerationController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

test('catalogue moderation is limited to the scoped moderation capability', () => {
  for (const method of ['list', 'open', 'decide'] as const) {
    const metadata = requirement(method);
    assert.equal(metadata?.capability, 'admin.catalogue.moderate');
    assert.deepEqual(metadata?.admin_scope, { kind: 'GLOBAL' });
    assert.equal(metadata?.conceal_resource, true);
  }
});
