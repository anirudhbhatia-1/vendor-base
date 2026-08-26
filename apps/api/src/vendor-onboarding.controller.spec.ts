import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import {
  AUTHORIZATION_REQUIREMENT,
  SESSION_REQUIREMENT,
  type AuthorizationRequirement,
} from './authorization.js';
import { VendorOnboardingController } from './vendor-onboarding.controller.js';

function authorization(
  method: keyof VendorOnboardingController,
): AuthorizationRequirement | undefined {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    VendorOnboardingController.prototype[method],
  ) as AuthorizationRequirement | undefined;
}

test('keeps applicant onboarding routes behind an authenticated session', () => {
  for (const method of [
    'createApplication',
    'claimInvitation',
    'submitProfile',
    'uploadDocument',
    'applicantCase',
    'appeal',
  ] as const) {
    assert.equal(
      Reflect.getMetadata(SESSION_REQUIREMENT, VendorOnboardingController.prototype[method]),
      true,
      `${method} is not session protected`,
    );
  }
});

test('separates onboarding workflow operations from evidence review', () => {
  assert.equal(authorization('createLead')?.capability, 'admin.vendor_onboarding.manage');
  assert.equal(authorization('createInvitation')?.capability, 'admin.vendor_onboarding.manage');
  assert.equal(authorization('advanceDeadlines')?.capability, 'admin.vendor_onboarding.manage');
  assert.equal(authorization('startReview')?.capability, 'admin.vendor_onboarding.manage');
  for (const method of [
    'reviewDocument',
    'approve',
    'reject',
    'grace',
    'reviewAppeal',
    'documentAccess',
    'documentContent',
  ] as const) {
    const requirement = authorization(method);
    assert.equal(requirement?.capability, 'admin.vendor_onboarding.review');
    assert.equal(requirement?.admin_scope?.kind, 'GLOBAL');
    assert.equal(requirement?.conceal_resource, true);
  }
});
