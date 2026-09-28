import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { correctionAmount, impactSentence } from './corrections-panel.js';
import { conservationSentence } from './finance-queues-panel.js';
import { accessDeniedMessage, dueSentence } from './admin-workspace.js';
import { interventionBody, timeInState } from './order-intervention-panel.js';

/**
 * The admin console reaches the API through raw path strings rather than the
 * typed client, which is where the refund path silently drifted to a route that
 * did not exist. `tooling/scripts/verify-api-contracts.mjs` now checks those
 * strings against the controllers on every lint; this spec pins the specific
 * surfaces each panel is responsible for, so deleting one is a visible change
 * rather than a quietly missing feature.
 */
const directory = path.resolve(import.meta.dirname);

function panel(file: string): string {
  return fs.readFileSync(path.join(directory, file), 'utf8');
}

const expectations: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['policy-panel.tsx', ['admin/configuration', 'admin/configuration/drafts']],
  [
    'incidents-panel.tsx',
    ['admin/control/incidents', 'admin/control/maintenance/expire', 'admin/control/dashboard'],
  ],
  [
    'support-panel.tsx',
    [
      'admin/control/support',
      'admin/control/support/${selected}/evidence',
      'admin/control/support/${selected}/merge',
    ],
  ],
  ['trust-panel.tsx', ['admin/control/trust', 'admin/control/trust/${selected}/${action}']],
  [
    'reporting-panel.tsx',
    ['admin/control/exports', 'admin/control/exports/redeem', 'admin/control/audit'],
  ],
  [
    'verification-panel.tsx',
    ['admin/vendor-onboarding/${caseId}', 'admin/partner-applications/${caseId}/start-review'],
  ],
  [
    'finance-queues-panel.tsx',
    [
      'admin/finance/payments',
      'admin/finance/refunds',
      'admin/finance/v2/payout-jobs/daily',
      'admin/finance/v2/ledger',
      'admin/finance/v2/ledger/conservation',
    ],
  ],
  [
    'order-intervention-panel.tsx',
    [
      'admin/orders/monitor',
      'admin/orders/${order.vendor_order_id}/timeline',
      'admin/orders/${selected.vendor_order_id}/interventions/${kind}/preview',
      'admin/orders/${selected.vendor_order_id}/interventions/${preview.kind}',
    ],
  ],
  [
    'corrections-panel.tsx',
    [
      'admin/finance/v2/ledger/transactions/${transactionId.trim()}',
      'admin/finance/v2/corrections/preview',
      'admin/finance/v2/corrections',
      'admin/finance/v2/corrections/${id}/approve-post',
      'admin/finance/v2/corrections/${id}/reject',
    ],
  ],
  [
    'operations-health-panel.tsx',
    [
      'admin/control/dead-letters',
      'admin/control/dead-letters/${event.event_id}/recover',
      'admin/control/orders?stalled_only=true',
    ],
  ],
  ['zone-controls-panel.tsx', ['admin/zones', 'admin/zones/${zone.service_zone_id}/${action}']],
];

for (const [file, paths] of expectations) {
  test(`${file} calls the operational surface it owns`, () => {
    const source = panel(file);
    for (const expected of paths) {
      assert.ok(source.includes(expected), `${file} should call ${expected}`);
    }
  });
}

test('the verification panel can answer an appeal', () => {
  assert.ok(panel('verification-panel.tsx').includes('/appeals/${appealId}/review'));
});

test('trust proposals use the subject and scope kinds the schema allows', () => {
  const source = panel('trust-panel.tsx');
  for (const kind of ['CUSTOMER', 'VENDOR_LOCATION', 'PARTNER', 'CATEGORY']) {
    assert.ok(source.includes(`'${kind}'`), `subject kind ${kind}`);
  }
  // The database rejects anything outside its CHECK constraint, so a plausible
  // looking value such as DELIVERY_PARTNER would fail only at runtime.
  assert.ok(!source.includes("'DELIVERY_PARTNER'"));
  assert.ok(source.includes('SYNTH-EVIDENCE-'), 'evidence reference shape');
  assert.ok(source.includes('SYNTH-POLICY-'), 'policy reference shape');
});

test('incident controls use the keys the schema allows', () => {
  const source = panel('incidents-panel.tsx');
  for (const key of ['GROUPED_CHECKOUT_PAUSE', 'DELIVERY_PAUSE', 'PAYOUT_PAUSE']) {
    assert.ok(source.includes(key), `control key ${key}`);
  }
  assert.ok(!source.includes('ORDER_INTAKE_PAUSED'));
});

test('report exports use a kind both the reader and the export register accept', () => {
  const source = panel('reporting-panel.tsx');
  assert.ok(source.includes("'MARKETPLACE'"));
  assert.ok(!source.includes("'MARKETPLACE_HEALTH'"));
});

test('no admin panel writes to the removed v2 refund path', () => {
  for (const [file] of expectations) {
    assert.ok(
      !panel(file).includes('admin/finance/v2/refunds'),
      `${file} must use admin/finance/refunds`,
    );
  }
});

test('operational health is read-only until an operator gives a reason', () => {
  const source = panel('operations-health-panel.tsx');
  // Recovery re-runs a side effect that moves real state, so it must carry a
  // reason code rather than being a bare button.
  assert.ok(source.includes("reason_code: 'OPERATOR_REDELIVERY'"), 'recovery states its reason');
  assert.ok(!source.includes('DELETE'), 'the panel never deletes an event');
});

test('closing a zone sends the version it read', () => {
  const source = panel('zone-controls-panel.tsx');
  assert.ok(
    source.includes('expected_version: zone.version'),
    'a zone change must lose to a concurrent one rather than clobber it',
  );
  assert.ok(source.includes('suspend'), 'the panel can close a zone');
  assert.ok(source.includes('resume'), 'and reopen it');
});

test('an operator places a provisioned store on the map rather than typing coordinates', () => {
  const source = panel('onboarding-panel.tsx');
  assert.ok(source.includes('<LocationPicker'), 'the store is placed on the map');
  assert.ok(
    source.includes("throw new Error('Place the store on the map first.')"),
    'and cannot be created without a point',
  );
  assert.ok(
    !/vLat|vLng|26\.8505|75\.7628/.test(source),
    'no typed coordinates and no default point remain',
  );
});

test('a correction is proposed with what the API requires, after a preview (10.6)', () => {
  const source = panel('corrections-panel.tsx');
  for (const field of [
    'original_ledger_transaction_id',
    'evidence_reference',
    'reason_code',
    'amount_minor: correctionAmount(entries)',
    'expected_version: correction.version',
  ]) {
    assert.ok(source.includes(field), `the panel sends ${field}`);
  }
  assert.ok(source.includes('disabled={!preview}'), 'nothing is proposed unpreviewed');
  // The order monitor no longer proposes a correction it cannot describe.
  assert.ok(
    !panel('order-intervention-panel.tsx').includes("correction_kind: 'ORDER_INTERVENTION'"),
  );
});

test('a correction amount is its debits, and its impact reads per owner (10.6)', () => {
  assert.equal(
    correctionAmount([
      { account_reference: 'A', component: 'ADJUSTMENT', debit_minor: 250, credit_minor: 0 },
      { account_reference: 'B', component: 'ADJUSTMENT', debit_minor: 0, credit_minor: 250 },
    ]),
    250,
  );
  assert.equal(
    impactSentence({
      account_reference: 'SYNTH-ACCOUNT-VENDOR-PAYABLE',
      vendor_location_id: '01a0e73e-8d62-75b2',
      partner_user_id: null,
      change_debit_minor: 100,
    }),
    'vendor payable for shop 01a0e73e debited ₹1.00 more',
  );
});

test('the finance screen says whether the books agree with the records (10.7)', () => {
  assert.equal(
    conservationSentence({ conserved: true, checked: { vendors: 3, partners: 2 }, breaches: [] }),
    'The books agree with what 3 shops and 2 partners are owed.',
  );
  assert.match(
    conservationSentence({
      conserved: false,
      checked: { vendors: 1, partners: 0 },
      breaches: [
        { invariant: 'VENDOR_PAYABLE', subject: 'shop-a', ledger_minor: 1, expected_minor: 0 },
      ],
    }),
    /1 disagreement\(s\).*vendor payable for shop-a/,
  );
});

test('a queue outside the role is refused safely, and a row says when it is due (11.1)', () => {
  assert.equal(
    accessDeniedMessage(Object.assign(new Error('Forbidden'), { status: 403 }), 'Finance'),
    'Finance is not part of your role.',
  );
  assert.equal(
    accessDeniedMessage(Object.assign(new Error('Not found'), { status: 404 }), 'Finance'),
    'Finance is not part of your role.',
  );
  const now = new Date('2027-07-01T10:00:00.000Z');
  assert.equal(
    dueSentence(
      {
        sla_due_at: '2027-07-01T09:50:00.000Z',
        overdue: true,
        escalation_due: true,
        escalation_owner: 'INCIDENT_COMMANDER',
      },
      now,
    ),
    'overdue by 10 min · escalate to incident commander',
  );
  const source = panel('admin-workspace.tsx');
  assert.ok(source.includes('Promise.allSettled'), 'one refused queue does not blank the page');
  assert.ok(source.includes('workTrace.audit_event_id'), 'the view shows its audit reference');
});

test('an intervention is confirmed with the versions its preview read and a reason (11.2)', () => {
  const body = interventionBody(
    {
      kind: 'REASSIGN',
      allowed: true,
      blocked_reason: null,
      effects: [],
      notifies: [],
      required_capability: 'admin.delivery.assignment_manage',
      approval: 'NONE',
      expected: { order_version: 4, assignment_version: 7 },
    },
    'PARTNER_UNREACHABLE',
    { compensation_minor: 1_500 },
  );
  assert.deepEqual(body, {
    confirm: true,
    reason_code: 'PARTNER_UNREACHABLE',
    expected_order_version: 4,
    expected_assignment_version: 7,
    compensation_minor: 1_500,
  });
  assert.equal(timeInState(45), '45s in state');
  assert.equal(timeInState(600), '10 min in state');
  const source = panel('order-intervention-panel.tsx');
  assert.ok(!source.includes('customer/finance/receipts'), 'the timeline is the admin route');
  assert.ok(!source.includes('const consequences'), 'no preview is written in the browser');
});
