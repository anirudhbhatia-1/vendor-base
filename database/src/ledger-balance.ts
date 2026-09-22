import { MoneyStateError } from './money-lifecycle.js';

/**
 * The trial balance (10.1): every account in the catalogue with what has
 * been posted to it, and the books' two totals.
 *
 * Money is shown only when it balances. A read that rendered an unbalanced
 * book would be the one place a figure could be seen that the ledger never
 * agreed to, so the read refuses instead — the schema's commit-time check
 * makes that unreachable through the posting engine, and this keeps it
 * unreachable through anything that bypassed the engine.
 */
export interface LedgerAccountBalanceRow {
  readonly account_reference: string;
  readonly account_type: string;
  readonly owner_kind: string;
  readonly owner_dimension: string;
  readonly normal_side: 'CREDIT' | 'DEBIT';
  readonly lifecycle_state: string;
  readonly debit_minor: string;
  readonly credit_minor: string;
  readonly entries: string;
}

export interface LedgerTrialBalance {
  readonly accounts: readonly {
    readonly account_reference: string;
    readonly account_type: string;
    readonly owner_kind: string;
    readonly owner_dimension: string;
    readonly normal_side: 'CREDIT' | 'DEBIT';
    readonly lifecycle_state: string;
    readonly debit_minor: number;
    readonly credit_minor: number;
    /** Debits less credits, signed towards the account's normal side. */
    readonly balance_minor: number;
    readonly entries: number;
  }[];
  readonly currency: 'INR';
  readonly totals: { readonly debit_minor: number; readonly credit_minor: number };
  readonly balanced: true;
}

function paise(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new MoneyStateError(`${label} is not integer paise`);
  return parsed;
}

export function assembleTrialBalance(rows: readonly LedgerAccountBalanceRow[]): LedgerTrialBalance {
  const accounts = rows.map((row) => {
    const debit = paise(row.debit_minor, `${row.account_reference} debits`);
    const credit = paise(row.credit_minor, `${row.account_reference} credits`);
    return {
      account_reference: row.account_reference,
      account_type: row.account_type,
      owner_kind: row.owner_kind,
      owner_dimension: row.owner_dimension,
      normal_side: row.normal_side,
      lifecycle_state: row.lifecycle_state,
      debit_minor: debit,
      credit_minor: credit,
      balance_minor: row.normal_side === 'DEBIT' ? debit - credit : credit - debit,
      entries: Number(row.entries),
    };
  });
  const totals = accounts.reduce(
    (sum, account) => ({
      debit_minor: sum.debit_minor + account.debit_minor,
      credit_minor: sum.credit_minor + account.credit_minor,
    }),
    { debit_minor: 0, credit_minor: 0 },
  );
  if (totals.debit_minor !== totals.credit_minor)
    throw new MoneyStateError(
      `Ledger does not balance: debits ${totals.debit_minor} against credits ${totals.credit_minor}`,
    );
  return Object.freeze({ accounts, currency: 'INR', totals, balanced: true });
}
