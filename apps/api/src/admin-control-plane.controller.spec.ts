import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { AdminControlPlaneController } from './admin-control-plane.controller.js';

function auth(method: string): AuthorizationRequirement | undefined {
  const handler = (AdminControlPlaneController.prototype as unknown as Record<string, object>)[
    method
  ];
  return handler
    ? (Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) as
        AuthorizationRequirement | undefined)
    : undefined;
}
test('every admin control-plane route is capability protected and globally scoped', () => {
  const expected: Record<string, string> = {
    dashboard: 'admin.control.dashboard_read',
    orders: 'admin.control.dashboard_read',
    deadLetters: 'admin.messaging.deadletter_read',
    recoverDeadLetter: 'admin.messaging.deadletter_recover',
    createSupport: 'admin.support.case_manage',
    support: 'admin.support.case_manage',
    evidence: 'admin.support.case_manage',
    merge: 'admin.support.case_manage',
    trust: 'admin.trust.restriction_propose',
    approveTrust: 'admin.trust.restriction_approve',
    transitionTrust: 'admin.trust.restriction_approve',
    incident: 'admin.incident.manage',
    revokeIncident: 'admin.incident.manage',
    expire: 'admin.incident.manage',
    audit: 'admin.audit.read',
    report: 'admin.reporting.read',
    export: 'admin.reporting.export',
    redeem: 'admin.reporting.export',
  };
  for (const [method, capability] of Object.entries(expected)) {
    const rule = auth(method);
    assert.equal(rule?.capability, capability, method);
    assert.deepEqual(rule?.admin_scope, { kind: 'GLOBAL' }, method);
    assert.equal(rule?.conceal_resource, true, method);
  }
});
