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

function seeded(seed: number) {
  let state = seed >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % below;
  };
}

/** A random balanced posting over a handful of accounts and owners. */
function posting(next: (below: number) => number) {
  const accounts = [
    ['SYNTH-ACCOUNT-PLATFORM-CLEARING', null],
    ['SYNTH-ACCOUNT-VENDOR-PAYABLE', 'vendor-a'],
    ['SYNTH-ACCOUNT-VENDOR-PAYABLE', 'vendor-b'],
    ['SYNTH-ACCOUNT-PLATFORM-REVENUE', null],
  ] as const;
  const entries = [];
  let open = 0;
  for (let index = 0; index < 1 + next(4); index += 1) {
    const [account, vendor] = accounts[next(accounts.length)] ?? accounts[0];
    const value = 1 + next(50_000);
    entries.push({
      account_reference: account,
      debit_minor: value,
      credit_minor: 0,
      vendor_location_id: vendor,
    });
    open += value;
  }
  const [account, vendor] = accounts[next(accounts.length)] ?? accounts[0];
  entries.push({
    account_reference: account,
    debit_minor: 0,
    credit_minor: open,
    vendor_location_id: vendor,
  });
  return entries;
}

test('any correction of any posting moves as much money out as in (10.7)', () => {
  const next = seeded(20_270_708);
  for (let run = 0; run < 2_000; run += 1) {
    const before = posting(next);
    const after = posting(next);
    const impact = correctionImpact(before, after);
    const seen = JSON.stringify({ run, before, after, impact });
    const change = impact.rows.reduce((sum, row) => sum + row.change_debit_minor, 0);
    assert.equal(change, 0, seen);
    assert.equal(
      impact.impact_minor,
      impact.rows.reduce((sum, row) => sum + Math.max(0, row.change_debit_minor), 0),
      seen,
    );
    // Correcting a posting back to itself moves nothing.
    assert.equal(correctionImpact(after, after).impact_minor, 0, seen);
  }
});
