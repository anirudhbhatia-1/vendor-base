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
/**
 * Field routes addressed by assignment.
 *
 * `partner.assignment.act` carries the ACTIVE_ASSIGNMENT resource rule, which
 * grants only when the request supplies a `delivery_assignment_id` matching the
 * caller's active assignment — so a route using it *must* bind the parameter.
 * This decorator did not, and the rule therefore never granted: every guided
 * exception and every offline capture answered "not found" to its own owner.
 */
const fieldRoutes = [
  'saveOfflineProof',
  'raiseException',
  'resolveException',
  'listExceptions',
] as const;

/** Self-scoped field routes, which carry no assignment to check. */
const selfFieldRoutes = ['listPendingProofs', 'syncOfflineProof'] as const;

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
    // Without this the ACTIVE_ASSIGNMENT rule has no evidence and can never
    // grant, which is precisely how these routes came to be unreachable.
    assert.equal(
      fieldAuth(method)?.delivery_assignment_id_param,
      'delivery_assignment_id',
      `${method} must bind the assignment it acts on`,
    );
  }
});

test('self-scoped field routes do not claim an assignment rule they cannot satisfy', () => {
  for (const method of selfFieldRoutes) {
    assert.equal(fieldAuth(method)?.capability, 'partner.field.read', `${method}`);
    assert.equal(
      fieldAuth(method)?.delivery_assignment_id_param,
      undefined,
      `${method} is not addressed by assignment`,
    );
  }
});
