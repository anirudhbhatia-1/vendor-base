import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import {
  AdminSupportCaseController,
  CustomerSupportCaseController,
} from './support-case.controller.js';

function auth(controller: { prototype: object }, method: string) {
  const handler = (controller.prototype as unknown as Record<string, object>)[method];
  return handler
    ? (Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) as
        AuthorizationRequirement | undefined)
    : undefined;
}

test('support cases are worked under the case capability, globally and concealed (11.3)', () => {
  for (const method of ['queue', 'open', 'detail', 'act']) {
    const rule = auth(AdminSupportCaseController, method);
    assert.equal(rule?.capability, 'admin.support.case_manage', method);
    assert.deepEqual(rule?.admin_scope, { kind: 'GLOBAL' }, method);
    assert.equal(rule?.conceal_resource, true, method);
  }
});

test("a customer reads and answers only their own cases' participant thread (11.3)", () => {
  for (const method of ['list', 'detail', 'message']) {
    const rule = auth(CustomerSupportCaseController, method);
    assert.equal(rule?.capability, 'customer.order.read', method);
    assert.equal(rule?.conceal_resource, true, method);
  }
});
