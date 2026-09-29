import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import {
  AdminTrustReviewController,
  CustomerRestrictionController,
  PartnerRestrictionController,
  VendorRestrictionController,
} from './trust-review.controller.js';

function auth(controller: { prototype: object }, method: string) {
  const handler = (controller.prototype as unknown as Record<string, object>)[method];
  return handler
    ? (Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) as
        AuthorizationRequirement | undefined)
    : undefined;
}

test('trust review reads, proposes and decides under separate capabilities, globally (11.4)', () => {
  const expected: Record<string, string> = {
    signals: 'admin.control.dashboard_read',
    dismiss: 'admin.control.dashboard_read',
    subject: 'admin.control.dashboard_read',
    cases: 'admin.control.dashboard_read',
    detail: 'admin.control.dashboard_read',
    collect: 'admin.trust.restriction_propose',
    proposeCase: 'admin.trust.restriction_propose',
    act: 'admin.trust.restriction_approve',
  };
  for (const [method, capability] of Object.entries(expected)) {
    const rule = auth(AdminTrustReviewController, method);
    assert.equal(rule?.capability, capability, method);
    assert.deepEqual(rule?.admin_scope, { kind: 'GLOBAL' }, method);
    assert.equal(rule?.conceal_resource, true, method);
  }
});

test('the person restricted reads and appeals only their own restrictions (11.4)', () => {
  assert.equal(auth(PartnerRestrictionController, 'list')?.capability, 'partner.standing.read');
  assert.equal(auth(PartnerRestrictionController, 'appeal')?.capability, 'partner.standing.read');
  assert.equal(auth(CustomerRestrictionController, 'list')?.capability, 'customer.order.read');
  assert.equal(
    auth(CustomerRestrictionController, 'appeal')?.capability,
    'customer.account.manage',
  );
  for (const method of ['list', 'appeal']) {
    const rule = auth(VendorRestrictionController, method);
    assert.equal(rule?.capability, 'vendor.location.read', method);
    assert.equal(rule?.vendor_location_id_param, 'vendor_location_id', method);
  }
});
