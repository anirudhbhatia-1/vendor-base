import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { correctionAmount, impactSentence } from './corrections-panel.js';
import { conservationSentence } from './finance-queues-panel.js';
import { accessDeniedMessage, dueSentence } from './admin-workspace.js';
import { interventionBody, timeInState } from './order-intervention-panel.js';
import { supportActionBody, turnSentence, type ActionForm } from './support-panel.js';
import { decisionBody, proposalBody, type ProposalForm } from './trust-panel.js';
import { ageText, exceptionActionBody, valuesText } from './finance-exceptions-queue.js';
import {
  actionsFor,
  draftBody,
  earliestStart,
  parseDraftValue,
  PROTECTED_NOTICE_MS,
  reasonCode,
} from './policy-panel.js';

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
  [
    'policy-panel.tsx',
    [
      'admin/configuration/catalogue',
      'admin/configuration',
      'admin/configuration/drafts',
      'admin/configuration/${id}',
      'admin/configuration/${detail.configuration_version_id}/${action}',
    ],
  ],
  [
    'incidents-panel.tsx',
    ['admin/control/incidents', 'admin/control/maintenance/expire', 'admin/control/dashboard'],
  ],
  [
    'support-panel.tsx',
    [
      'admin/support/cases?view=${view}&owner=${owner}',
      'admin/support/cases/${caseId}',
      'admin/support/cases',
      'admin/support/cases/${detail.support_case_id}/actions/${action}',
    ],
  ],
  [
    'trust-panel.tsx',
    [
      'admin/trust/signals',
      'admin/trust/signals/collect',
      'admin/trust/cases?view=WORK',
      'admin/trust/cases',
      'admin/trust/cases/${detail.trust_restriction_case_id}/actions/${action}',
    ],
  ],
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
    'finance-exceptions-queue.tsx',
    [
      'admin/finance/queues',
      'admin/finance/queues/exceptions/${row.finance_exception_id}',
      'admin/finance/queues/exceptions/${detail.finance_exception_id}/actions/${action}',
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

test('trust proposals take the subject and its scopes from the server (11.4)', () => {
  const source = panel('trust-panel.tsx');
  // The subject comes from the signal queue and its scopes from the dossier,
  // so a value the schema rejects cannot be typed in.
  assert.ok(source.includes('dossier.allowed_scopes.map'), "scopes are the subject's own");
  assert.ok(!source.includes("'DELIVERY_PARTNER'"));
  assert.ok(source.includes('SYNTH-EVIDENCE-'), 'evidence reference shape');
  assert.ok(source.includes('SYNTH-POLICY-'), 'policy reference shape');
  assert.ok(source.includes('<ConfirmDialog'), 'decisions go through a confirmation');
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

const form: ActionForm = {
  reason_code: '',
  body: '  The refund went back to your card.  ',
  owner_user_id: '',
  owner_team: 'OPERATIONS_LEAD',
  severity: '',
  respond_within_hours: '6',
  resolution_code: 'REFUNDED',
  refund_id: ' 01900000-0000-7000-8000-000000000001 ',
  outcome: 'PASS',
  evidence_reference: '',
  classification: 'INTERNAL',
  target_case_id: '',
};

test('every support step carries the version on screen and a reason (11.3)', () => {
  const resolve = supportActionBody('RESOLVE', form, 4);
  assert.deepEqual(resolve, {
    expected_version: 4,
    reason_code: 'SUPPORT_RESOLVE',
    body: 'The refund went back to your card.',
    resolution_code: 'REFUNDED',
    refund_id: '01900000-0000-7000-8000-000000000001',
  });
  // A refund id is only sent with a refund resolution.
  assert.equal(
    'refund_id' in supportActionBody('RESOLVE', { ...form, resolution_code: 'EXPLAINED' }, 4),
    false,
  );
  assert.deepEqual(supportActionBody('ASSIGN', form, 2), {
    expected_version: 2,
    reason_code: 'SUPPORT_ASSIGN',
    owner_team: 'OPERATIONS_LEAD',
  });
  assert.equal(supportActionBody('REQUEST_RESPONSE', form, 1).respond_within_seconds, 21_600);
  assert.equal(
    supportActionBody('REOPEN', { ...form, reason_code: 'CUSTOMER_CALLED' }, 7).reason_code,
    'CUSTOMER_CALLED',
  );
});

test('a case says whose turn it is and when (11.3)', () => {
  const now = new Date('2026-09-28T10:00:00Z');
  assert.equal(
    turnSentence({ awaiting: 'OPERATIONS', response_due_at: '2026-09-28T10:15:00Z' }, now),
    'Support owes a reply, due in 15 min.',
  );
  assert.equal(
    turnSentence({ awaiting: 'OPERATIONS', response_due_at: '2026-09-28T09:50:00Z' }, now),
    'Support owes a reply, 10 min overdue.',
  );
  assert.match(
    turnSentence({ awaiting: 'PARTICIPANT', response_due_at: '2026-09-28T10:30:00Z' }, now),
    /^Waiting on the customer; follow up due in 30 min\.$/,
  );
  assert.equal(
    turnSentence({ awaiting: 'NONE', response_due_at: null }, now),
    'Nobody owes a reply.',
  );
});

test('a proposal carries its scope, dates and chosen evidence (11.4)', () => {
  const now = new Date('2026-09-29T10:00:00Z');
  const form: ProposalForm = {
    scope_kind: 'GLOBAL',
    scope_reference: 'ignored',
    reason_code: 'THREAT_AT_DOOR',
    policy_reference: ' SYNTH-POLICY-SAFETY-1 ',
    evidence_reference: '',
    proposal_note: '',
    days: 7,
    review_days: 14,
    signal_ids: ['a', 'b'],
  };
  const body = proposalBody({ subject_kind: 'CUSTOMER', subject_reference: 'c' }, form, now);
  assert.equal(body.scope_reference, 'GLOBAL');
  assert.equal(body.policy_reference, 'SYNTH-POLICY-SAFETY-1');
  assert.equal('evidence_reference' in body, false);
  assert.equal(body.effective_until, '2026-10-06T10:00:00.000Z');
  // A review never falls after the end.
  assert.equal(body.review_at, '2026-10-06T10:00:00.000Z');
});

test('every trust decision carries the version on screen and its outcome (11.4)', () => {
  assert.deepEqual(decisionBody('APPROVE', 'EVIDENCE_CORROBORATED', 3, {}), {
    expected_version: 3,
    reason_code: 'EVIDENCE_CORROBORATED',
  });
  assert.equal(decisionBody('DECIDE_APPEAL', 'APPEAL_CONSIDERED', 4, {}).outcome, 'UPHOLD');
  const shorten = decisionBody('REVIEW', 'SCHEDULED_REVIEW', 5, {
    outcome: 'SHORTEN',
    date: '2026-10-01T10:00:00Z',
  });
  assert.equal(shorten.effective_until, '2026-10-01T10:00:00.000Z');
  assert.equal('review_at' in shorten, false);
  assert.equal(
    'review_at' in decisionBody('REVIEW', 'SCHEDULED_REVIEW', 5, { outcome: 'LIFT' }),
    false,
  );
});

test('a finance row reads expected against actual, and its age in the largest unit (11.5)', () => {
  assert.equal(valuesText({ expected_minor: 20_000, actual_minor: 0 }).includes('expected'), true);
  assert.equal(valuesText({ expected_minor: null, actual_minor: null }), '— expected · — actual');
  assert.equal(ageText(90), '2 min');
  assert.equal(ageText(7_200), '2 h');
  assert.equal(ageText(3 * 86_400), '3 d');
});

test('each finance step carries the version on screen and only its own fields (11.5)', () => {
  const fields = {
    note: '  why  ',
    evidence_reference: ' SYNTH-EVIDENCE-X ',
    financial_correction_id: '',
    resolution_code: 'PROVIDER_CONFIRMED',
    provider_state: 'FAILED',
  };
  assert.deepEqual(exceptionActionBody('RECONCILE', 'PROVIDER_CONTACTED', 3, fields), {
    expected_version: 3,
    reason_code: 'PROVIDER_CONTACTED',
    evidence_reference: 'SYNTH-EVIDENCE-X',
    provider_state: 'FAILED',
  });
  assert.deepEqual(exceptionActionBody('RESOLVE', 'LEDGER_REVIEWED', 4, fields), {
    expected_version: 4,
    reason_code: 'LEDGER_REVIEWED',
    resolution_code: 'PROVIDER_CONFIRMED',
  });
  assert.equal(
    'financial_correction_id' in exceptionActionBody('LINK_CORRECTION', 'X_X_X', 1, fields),
    false,
  );
  assert.equal(exceptionActionBody('NOTE', 'SECOND_LOOK', 2, fields).note, 'why');
});

test('the policy screen drafts catalogued settings in the shape the server stores (11.6)', () => {
  // The global scope is stored as 'global'; the screen sent 'GLOBAL'.
  assert.deepEqual(
    draftBody(
      { key: 'vendor.accept_deadline_seconds' },
      'GLOBAL',
      'x',
      300,
      'slower shops need time',
    ),
    {
      configuration_key: 'vendor.accept_deadline_seconds',
      configuration_value: 300,
      scope_kind: 'GLOBAL',
      scope_reference: 'global',
      reason_code: 'SLOWER_SHOPS_NEED_TIME',
    },
  );
  assert.equal(draftBody({ key: 'k' }, 'ZONE', ' zone-1 ', 1, 'r').scope_reference, 'zone-1');
  assert.deepEqual(parseDraftValue({ value_type: 'INTEGER' }, ' 300 '), { ok: true, value: 300 });
  assert.equal(parseDraftValue({ value_type: 'INTEGER' }, '3.5').ok, false);
  assert.equal(parseDraftValue({ value_type: 'JSON' }, '{').ok, false);
  assert.equal(reasonCode('  --  '), '');
  // A protected change's default start clears the server's hour of notice.
  const now = Date.UTC(2026, 8, 29);
  assert.ok(earliestStart(true, now).getTime() > now + PROTECTED_NOTICE_MS);
  assert.ok(earliestStart(false, now).getTime() > now);
});

test('each version offers only the steps its state allows (11.6)', () => {
  assert.deepEqual(actionsFor('DRAFT'), ['validate', 'reject']);
  assert.deepEqual(actionsFor('APPROVED'), ['schedule', 'reject']);
  assert.deepEqual(actionsFor('SCHEDULED'), ['cancel']);
  assert.deepEqual(actionsFor('SUPERSEDED'), ['rollback']);
  assert.deepEqual(actionsFor('REJECTED'), []);
  assert.deepEqual(actionsFor('CANCELLED'), []);
});
