import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import {
  AdminPartnerApplicationController,
  AdminPartnerDisputeController,
  AdminPartnerDocumentController,
  PartnerStandingController,
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
    // An ADMIN_SCOPE capability is evaluated against the scope in the
    // evidence; without one it can never match, and the queue answered 404.
    assert.deepEqual(adminAppAuth(method)?.admin_scope, { kind: 'GLOBAL' }, `${method} scope`);
  }
});

test('document renewal review is an admin partner-application review, and the partner reads standing', () => {
  // The renewal queue and decision (9.1) sit beside the application review:
  // the same reviewers, the same global scope.
  for (const method of ['queue', 'review'] as const) {
    const rule = Reflect.getMetadata(
      AUTHORIZATION_REQUIREMENT,
      AdminPartnerDocumentController.prototype[method],
    ) as AuthorizationRequirement | undefined;
    assert.equal(rule?.capability, 'admin.partner_application.review', method);
    assert.deepEqual(rule?.admin_scope, { kind: 'GLOBAL' }, `${method} scope`);
  }
  const standing = (method: keyof PartnerStandingController) =>
    Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, PartnerStandingController.prototype[method]) as
      AuthorizationRequirement | undefined;
  assert.equal(standing('eligibility')?.capability, 'partner.standing.read');
  assert.equal(standing('renewDocument')?.capability, 'partner.application.manage');
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

test('a directed resolution is applied to the attempt before the instruction is written (9.8)', async () => {
  const { createRequestContext } = await import('@neighbourhood-store/domain-types');
  const { requestContextStorage } = await import('./request-context-storage.js');
  const { AdminPartnerExceptionsController } = await import('./partner-lifecycle.controller.js');
  const calls: string[] = [];
  const controller = new AdminPartnerExceptionsController(
    {
      resolveException: async (input: { resolution_state: string; instruction?: string }) => {
        calls.push(`resolve:${input.resolution_state}:${input.instruction ?? '-'}`);
        return { resolution_state: input.resolution_state };
      },
    } as never,
    {
      direct: async (input: { direction: string; compensation_minor?: number }) => {
        calls.push(`direct:${input.direction}:${input.compensation_minor ?? '-'}`);
        return { assignment_state: 'UNASSIGNED' };
      },
    } as never,
  );
  await requestContextStorage.run(createRequestContext(), async () => {
    await controller.resolve('01a0c40b-070f-7393-8216-0df916eb851f', {
      command_reference: 'SYNTH-CMD-DIRECT-T1',
      exception_kind: 'VEHICLE_FAILURE',
      resolution_state: 'REASSIGN',
      reason_code: 'OPERATIONS_DIRECTED',
      instruction: 'Wait with the bag; another partner is coming.',
      compensation_minor: 500,
    });
    await controller.resolve('01a0c40b-070f-7393-8216-0df916eb851f', {
      command_reference: 'SYNTH-CMD-DIRECT-T2',
      exception_kind: 'VENDOR_DELAY',
      resolution_state: 'CONTINUE',
      reason_code: 'OPERATIONS_DIRECTED',
    });
  });
  assert.deepEqual(calls, [
    'direct:REASSIGN:500',
    'resolve:REASSIGN:Wait with the bag; another partner is coming.',
    'resolve:CONTINUE:-',
  ]);
});
