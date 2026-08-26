import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { MoneyLifecycleController } from './money-lifecycle.controller.js';

function authorization(method: string): AuthorizationRequirement | undefined {
  const handler = (MoneyLifecycleController.prototype as unknown as Record<string, object>)[method];
  return handler
    ? (Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) as
        AuthorizationRequirement | undefined)
    : undefined;
}

test('requires global finance authority for every synthetic money mutation', () => {
  for (const method of [
    'createPayment',
    'authorize',
    'capture',
    'proposeRefund',
    'approveRefund',
    'createSettlement',
    'schedulePayout',
    'submitPayout',
    'reconcilePayout',
  ]) {
    const rule = authorization(method);
    assert.equal(rule?.capability, 'admin.finance.ledger_manage');
    assert.deepEqual(rule?.admin_scope, { kind: 'GLOBAL' });
    assert.equal(rule?.conceal_resource, true);
  }
});
