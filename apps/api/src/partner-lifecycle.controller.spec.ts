import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import {
  AdminPartnerApplicationController,
  AdminPartnerDisputeController,
  PartnerApplicationController,
  PartnerEarningsController,
  PartnerFieldOpsController,
} from './partner-lifecycle.controller.js';

function appAuth(method: keyof PartnerApplicationController): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    PartnerApplicationController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}
function adminAppAuth(
  method: keyof AdminPartnerApplicationController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    AdminPartnerApplicationController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}
function earningsAuth(
  method: keyof PartnerEarningsController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    PartnerEarningsController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}
function adminDisputeAuth(
  method: keyof AdminPartnerDisputeController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    AdminPartnerDisputeController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}
function fieldAuth(method: keyof PartnerFieldOpsController): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    PartnerFieldOpsController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

const applicationRoutes = ['create', 'submit', 'get'] as const;
const adminApplicationRoutes = ['startReview', 'requestChanges', 'approve', 'reject'] as const;
const fieldRoutes = [
  'saveOfflineProof',
  'syncOfflineProof',
  'raiseException',
  'resolveException',
  'listExceptions',
] as const;

test('scopes every partner application route to partner.application.manage', () => {
  for (const method of applicationRoutes) {
    assert.equal(appAuth(method)?.capability, 'partner.application.manage', `${method}`);
    assert.equal(appAuth(method)?.conceal_resource, true, `${method} concealment`);
  }
});

test('scopes every admin partner application route to admin.partner_application.review', () => {
  for (const method of adminApplicationRoutes) {
    assert.equal(adminAppAuth(method)?.capability, 'admin.partner_application.review', `${method}`);
  }
});

test('separates earnings read from dispute open and withdrawal', () => {
  assert.equal(earningsAuth('list')?.capability, 'partner.earnings.read');
  assert.equal(earningsAuth('openDispute')?.capability, 'partner.earnings.dispute');
  assert.equal(earningsAuth('withdraw')?.capability, 'partner.earnings.dispute');
});

test('admin dispute resolve requires admin.partner_earnings.resolve', () => {
  assert.equal(adminDisputeAuth('resolve')?.capability, 'admin.partner_earnings.resolve');
});

test('field ops routes require partner.assignment.act with resource concealment', () => {
  for (const method of fieldRoutes) {
    assert.equal(fieldAuth(method)?.capability, 'partner.assignment.act', `${method}`);
    assert.equal(fieldAuth(method)?.conceal_resource, true, `${method}`);
  }
});
