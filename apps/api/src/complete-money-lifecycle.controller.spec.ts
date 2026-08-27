import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { AUTHORIZATION_REQUIREMENT, type AuthorizationRequirement } from './authorization.js';
import {
  CompleteMoneyAdminController,
  CustomerFinanceController,
  PartnerFinanceController,
  VendorFinanceController,
} from './complete-money-lifecycle.controller.js';

function auth(prototype: object, method: string): AuthorizationRequirement | undefined {
  const handler = (prototype as Record<string, object>)[method];
  return handler
    ? (Reflect.getMetadata(AUTHORIZATION_REQUIREMENT, handler) as
        AuthorizationRequirement | undefined)
    : undefined;
}

test('maker-checker and reconciliation commands require global finance authority', () => {
  for (const method of [
    'voidPayment',
    'createPayoutBatch',
    'schedulePayoutJob',
    'importStatement',
    'proposeCorrection',
    'approveCorrection',
    'postPartnerEarning',
    'exceptions',
  ]) {
    const rule = auth(CompleteMoneyAdminController.prototype, method);
    assert.equal(rule?.capability, 'admin.finance.ledger_manage', method);
    assert.deepEqual(rule?.admin_scope, { kind: 'GLOBAL' }, method);
    assert.equal(rule?.conceal_resource, true, method);
  }
});

test('finance projections are isolated by customer, vendor location, and partner identity', () => {
  assert.equal(
    auth(CustomerFinanceController.prototype, 'receipt')?.capability,
    'customer.order.read',
  );
  const vendor = auth(VendorFinanceController.prototype, 'statement');
  assert.equal(vendor?.capability, 'vendor.finance.read');
  assert.equal(vendor?.vendor_location_id_param, 'vendor_location_id');
  assert.equal(
    auth(PartnerFinanceController.prototype, 'statement')?.capability,
    'partner.finance.read',
  );
});
