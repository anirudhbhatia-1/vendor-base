import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleTrialBalance, type LedgerAccountBalanceRow } from './ledger-balance.js';

function row(
  reference: string,
  side: 'CREDIT' | 'DEBIT',
  debit: string,
  credit: string,
): LedgerAccountBalanceRow {
  return {
    account_reference: reference,
    account_type: side === 'DEBIT' ? 'CLEARING' : 'LIABILITY',
    owner_kind: 'PLATFORM',
    owner_dimension: 'NONE',
    normal_side: side,
    lifecycle_state: 'ACTIVE',
    debit_minor: debit,
    credit_minor: credit,
    entries: '1',
  };
}

test('a balanced book is shown with each balance signed towards its normal side', () => {
  const balance = assembleTrialBalance([
    row('SYNTH-ACCOUNT-CUSTOMER-CLEARING', 'DEBIT', '34900', '6000'),
    row('SYNTH-ACCOUNT-PLATFORM-CLEARING', 'DEBIT', '6000', '34900'),
  ]);
  assert.equal(balance.balanced, true);
  assert.deepEqual(balance.totals, { debit_minor: 40_900, credit_minor: 40_900 });
  assert.equal(balance.accounts[0]?.balance_minor, 28_900);
  // A debit-normal account in credit reads as a negative balance, not as a
  // credit balance the reader has to re-sign.
  assert.equal(balance.accounts[1]?.balance_minor, -28_900);
});

test('an unbalanced book is refused rather than rendered (10.1)', () => {
  assert.throws(
    () =>
      assembleTrialBalance([
        row('SYNTH-ACCOUNT-CUSTOMER-CLEARING', 'DEBIT', '34900', '0'),
        row('SYNTH-ACCOUNT-PLATFORM-CLEARING', 'DEBIT', '0', '34899'),
      ]),
    /Ledger does not balance: debits 34900 against credits 34899/,
  );
  assert.throws(
    () => assembleTrialBalance([row('SYNTH-ACCOUNT-CUSTOMER-CLEARING', 'DEBIT', '1.5', '1.5')]),
    /not integer paise/,
  );
});

test('an empty catalogue balances at zero', () => {
  const balance = assembleTrialBalance([]);
  assert.deepEqual(balance.totals, { debit_minor: 0, credit_minor: 0 });
  assert.equal(balance.accounts.length, 0);
});
