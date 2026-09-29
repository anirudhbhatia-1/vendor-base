import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { FinanceQueuesController } from './finance-queues.controller.js';

function auth(method: string): AuthorizationRequirement | undefined {
  const handler = (FinanceQueuesController.prototype as unknown as Record<string, object>)[method];
  return handler
    ? (Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) as
        AuthorizationRequirement | undefined)
    : undefined;
}

test('the finance queues are worked under the ledger capability, globally and concealed (11.5)', () => {
  for (const method of ['list', 'detail', 'act']) {
    const rule = auth(method);
    assert.equal(rule?.capability, 'admin.finance.ledger_manage', method);
    assert.deepEqual(rule?.admin_scope, { kind: 'GLOBAL' }, method);
    assert.equal(rule?.conceal_resource, true, method);
  }
});
