import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import {
  VendorAccessController,
  VendorSettingsController,
  VendorStaffController,
} from './vendor-staff.controller.js';

function staffAuthorization(
  method: keyof VendorStaffController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, VendorStaffController.prototype[method]) as
    AuthorizationRequirement | undefined;
}
function accessAuthorization(
  method: keyof VendorAccessController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    VendorAccessController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}
function settingsAuthorization(
  method: keyof VendorSettingsController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    VendorSettingsController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

const staffRoutes = ['invite', 'revoke', 'list', 'activity'] as const;
const settingsRoutes = [
  'profile',
  'ordering',
  'hours',
  'closure',
  'addZone',
  'deactivateZone',
  'fulfilmentModes',
] as const;

test('contains every staff route to vendor.staff.manage at the owning location', () => {
  for (const method of staffRoutes) {
    const rule = staffAuthorization(method);
    assert.equal(rule?.capability, 'vendor.staff.manage', `${method} capability`);
    assert.equal(rule.vendor_location_id_param, 'vendor_location_id', `${method} scope`);
    assert.equal(rule.conceal_resource, true, `${method} concealment`);
  }
});

test('scopes the access-summary route to vendor.staff.manage at the owning location', () => {
  const rule = accessAuthorization('mine');
  assert.equal(rule?.capability, 'vendor.staff.manage');
  assert.equal(rule.vendor_location_id_param, 'vendor_location_id');
  assert.equal(rule.conceal_resource, true);
});

test('contains every settings route to vendor.settings.manage at the owning location', () => {
  for (const method of settingsRoutes) {
    const rule = settingsAuthorization(method);
    assert.equal(rule?.capability, 'vendor.settings.manage', `${method} capability`);
    assert.equal(rule.vendor_location_id_param, 'vendor_location_id', `${method} scope`);
    assert.equal(rule.conceal_resource, true, `${method} concealment`);
  }
});

test('declares an authorization requirement on every exposed route', () => {
  const exposedStaff = Object.getOwnPropertyNames(VendorStaffController.prototype).filter(
    (name) => name !== 'constructor',
  );
  assert.deepEqual([...exposedStaff].sort(), [...staffRoutes].sort());
  const exposedSettings = Object.getOwnPropertyNames(VendorSettingsController.prototype).filter(
    (name) => name !== 'constructor',
  );
  assert.deepEqual([...exposedSettings].sort(), [...settingsRoutes].sort());
});
