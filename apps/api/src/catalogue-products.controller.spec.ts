import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { CatalogueProductsController } from './catalogue-products.controller.js';

function requirement(
  method: keyof CatalogueProductsController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    CatalogueProductsController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

test('keeps every vendor catalogue mutation within its vendor location', () => {
  for (const method of [
    'list',
    'create',
    'update',
    'lifecycle',
    'image',
    'substitution',
  ] as const) {
    const rule = requirement(method);
    assert.equal(rule?.capability, 'vendor.catalogue.manage');
    assert.equal(rule?.vendor_location_id_param, 'vendor_location_id');
    assert.equal(rule?.conceal_resource, true);
  }
});
