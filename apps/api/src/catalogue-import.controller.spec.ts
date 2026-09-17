import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { CatalogueImportController } from './catalogue-import.controller.js';

function authorization(
  method: keyof CatalogueImportController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    CatalogueImportController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

test('stage and commit require vendor catalogue management capability', () => {
  for (const method of ['stage', 'commit'] as const) {
    assert.equal(
      authorization(method)?.capability,
      'vendor.catalogue.manage',
      `${method} capability`,
    );
  }
});

test('stage and commit conceal resources to prevent cross-vendor enumeration', () => {
  for (const method of ['stage', 'commit'] as const) {
    assert.equal(authorization(method)?.conceal_resource, true, `${method} concealment`);
  }
});

test('template route requires vendor catalogue management capability', () => {
  const req = Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    CatalogueImportController.prototype['template'],
  ) as AuthorizationRequirement | undefined;
  assert.equal(req?.capability, 'vendor.catalogue.manage');
});
