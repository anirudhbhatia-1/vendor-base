import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { AdminOrderMonitorController } from './admin-order-monitor.controller.js';

function auth(method: string): AuthorizationRequirement | undefined {
  const handler = (AdminOrderMonitorController.prototype as unknown as Record<string, object>)[
    method
  ];
  return handler
    ? (Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) as
        AuthorizationRequirement | undefined)
    : undefined;
}

test('the order monitor is read under the dashboard, globally and concealed (11.2)', () => {
  for (const method of ['monitor', 'timeline', 'preview', 'intervene']) {
    const rule = auth(method);
    assert.equal(rule?.capability, 'admin.control.dashboard_read', method);
    assert.deepEqual(rule?.admin_scope, { kind: 'GLOBAL' }, method);
    assert.equal(rule?.conceal_resource, true, method);
  }
});
