import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { VendorInventoryController } from './vendor-inventory.controller.js';

function authorization(
  method: keyof VendorInventoryController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    VendorInventoryController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

test('contains every inventory route to an authorized vendor location', () => {
  for (const method of ['list', 'create', 'setStock', 'confirm', 'reservations'] as const) {
    const rule = authorization(method);
    assert.equal(rule?.capability, 'vendor.catalogue.manage');
    assert.equal(rule.vendor_location_id_param, 'vendor_location_id');
    assert.equal(rule.conceal_resource, true);
  }
});
