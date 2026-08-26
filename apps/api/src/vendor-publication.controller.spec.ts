import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { VendorPublicationController } from './vendor-publication.controller.js';

function authorization(
  method: keyof VendorPublicationController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    VendorPublicationController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}
test('separates publication preparation from approval', () => {
  for (const method of [
    'create',
    'list',
    'get',
    'evaluate',
    'submit',
    'publish',
    'pause',
    'unpublish',
  ] as const)
    assert.equal(authorization(method)?.capability, 'admin.vendor_publication.manage');
  assert.equal(authorization('decide')?.capability, 'admin.vendor_publication.review');
  assert.equal(authorization('decide')?.conceal_resource, true);
});
