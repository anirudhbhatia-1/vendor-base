import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import { MoneyLifecycleController } from './money-lifecycle.controller.js';

/**
 * The finance surface was write-only: an operator could propose a refund but
 * had nothing that listed the payments a refund applies to, so the admin PWA
 * invented its own path and 404ed. These read models close that gap and must
 * carry the same capability as the writes beside them.
 */
function authorization(method: string): AuthorizationRequirement | undefined {
  const handler = (MoneyLifecycleController.prototype as unknown as Record<string, unknown>)[
    method
  ];
  if (typeof handler !== 'function') return undefined;
  return Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) as
    AuthorizationRequirement | undefined;
}

test('the finance read models require the ledger-manage capability', () => {
  for (const method of ['listPayments', 'listRefunds']) {
    const requirement = authorization(method);
    assert.equal(requirement?.capability, 'admin.finance.ledger_manage', `${method} capability`);
    assert.deepEqual(requirement?.admin_scope, { kind: 'GLOBAL' }, `${method} scope`);
  }
});

test('the read models are concealed like the rest of the finance surface', () => {
  for (const method of ['listPayments', 'listRefunds']) {
    assert.equal(authorization(method)?.conceal_resource, true, `${method} concealment`);
  }
});
