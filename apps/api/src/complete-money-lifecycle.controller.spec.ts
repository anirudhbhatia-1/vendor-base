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
    // Sending a batch and releasing a refused partner payout (10.4).
    'submitPayoutBatch',
    'releaseFailedPartnerPayout',
    'schedulePayoutJob',
    'importStatement',
    'proposeCorrection',
    'approveCorrection',
    // The correction's preview, history and rejection (10.6).
    'previewCorrection',
    'corrections',
    'rejectCorrection',
    'postPartnerEarning',
    // The exception list moved to the finance queues (11.5,
    // finance-queues.controller.ts).
    // The books themselves (10.1) are read under the same authority that
    // may post to them; nothing else reads the ledger.
    'ledger',
    'ledgerTransaction',
    // Whether the books agree with the records (10.7).
    'conservation',
  ]) {
    const rule = auth(CompleteMoneyAdminController.prototype, method);
    assert.equal(rule?.capability, 'admin.finance.ledger_manage', method);
    assert.deepEqual(rule?.admin_scope, { kind: 'GLOBAL' }, method);
    assert.equal(rule?.conceal_resource, true, method);
  }
});

test('a shop challenges its own settlement line, and an operator answers it (VEN-50, 10.3)', async () => {
  const { VendorFinanceController, AdminVendorSettlementDisputeController } =
    await import('./complete-money-lifecycle.controller.js');
  for (const method of ['openDispute', 'withdrawDispute'] as const) {
    const rule = auth(VendorFinanceController.prototype, method);
    assert.equal(rule?.capability, 'vendor.finance.dispute', method);
    assert.equal(rule?.vendor_location_id_param, 'vendor_location_id', method);
    assert.equal(rule?.conceal_resource, true, method);
  }
  // Reading the statement and its raised challenges is the read capability;
  // raising one is not.
  assert.equal(
    auth(VendorFinanceController.prototype, 'disputes')?.capability,
    'vendor.finance.read',
  );
  const resolve = auth(AdminVendorSettlementDisputeController.prototype, 'resolve');
  assert.equal(resolve?.capability, 'admin.vendor_settlement.resolve');
  assert.deepEqual(resolve?.admin_scope, { kind: 'GLOBAL' });
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
