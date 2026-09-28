import assert from 'node:assert/strict';
import test from 'node:test';
import { correctionImpact, CorrectionImpactError } from './correction-impact.js';

const payable = (credit: number, vendor = 'vendor-a') => ({
  account_reference: 'SYNTH-ACCOUNT-VENDOR-PAYABLE',
  debit_minor: 0,
  credit_minor: credit,
  vendor_location_id: vendor,
});
const clearing = (debit: number) => ({
  account_reference: 'SYNTH-ACCOUNT-PLATFORM-CLEARING',
  debit_minor: debit,
  credit_minor: 0,
});

test('the impact is the replacement less the original, per account and owner', () => {
  // The shop was credited 1,000 and should have been credited 900.
  const impact = correctionImpact([clearing(1_000), payable(1_000)], [clearing(900), payable(900)]);
  assert.equal(impact.impact_minor, 100);
  assert.deepEqual(
    impact.rows.map((row) => [
      row.account_reference,
      row.vendor_location_id,
      row.change_debit_minor,
    ]),
    [
      ['SYNTH-ACCOUNT-PLATFORM-CLEARING', null, -100],
      ['SYNTH-ACCOUNT-VENDOR-PAYABLE', 'vendor-a', 100],
    ],
  );
});

test('money moved from one owner to another is reported for each', () => {
  const impact = correctionImpact(
    [clearing(500), payable(500, 'vendor-a')],
    [clearing(500), payable(500, 'vendor-b')],
  );
  assert.equal(impact.impact_minor, 500);
  assert.deepEqual(
    impact.rows.map((row) => [row.vendor_location_id, row.change_debit_minor]),
    [
      ['vendor-a', 500],
      ['vendor-b', -500],
    ],
  );
});

test('a replacement identical to the original moves nothing', () => {
  const entries = [clearing(700), payable(700)];
  assert.deepEqual(correctionImpact(entries, entries), { rows: [], impact_minor: 0 });
});

test('an unbalanced side is refused', () => {
  assert.throws(
    () => correctionImpact([clearing(700), payable(700)], [clearing(700), payable(600)]),
    CorrectionImpactError,
  );
});
