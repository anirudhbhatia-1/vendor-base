import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

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
    ['admin/finance/payments', 'admin/finance/refunds', 'admin/finance/v2/payout-jobs/daily'],
  ],
  [
    'order-intervention-panel.tsx',
    [
      'admin/control/orders',
      'admin/finance/v2/corrections',
      'admin/finance/v2/corrections/${correctionId}/approve-post',
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
