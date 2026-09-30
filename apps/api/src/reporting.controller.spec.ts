import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { ReportingController } from './reporting.controller.js';

function rule(method: keyof ReportingController): AuthorizationRequirement {
  return Reflect.getMetadata(
    AUTHORIZATION_REQUIREMENT,
    ReportingController.prototype[method],
  ) as AuthorizationRequirement;
}

test('reports are opened by every admin role and decided per report; exports need export authority (11.8)', () => {
  for (const method of ['catalogue', 'exports', 'report'] as const) {
    assert.equal(rule(method).capability, 'admin.control.dashboard_read', method);
    assert.deepEqual(rule(method).admin_scope, { kind: 'GLOBAL' }, method);
  }
  for (const method of ['export', 'redeem'] as const)
    assert.equal(rule(method).capability, 'admin.reporting.export', method);
  // A zone is read, and exported, under that zone's membership.
  assert.deepEqual(rule('zoneReport').admin_scope, {
    kind: 'ZONE',
    scope_id_param: 'service_zone_id',
  });
  assert.equal(rule('zoneReport').capability, 'admin.control.dashboard_read');
  assert.deepEqual(rule('zoneExport').admin_scope, {
    kind: 'ZONE',
    scope_id_param: 'service_zone_id',
  });
  assert.equal(rule('zoneExport').capability, 'admin.reporting.export');
});
