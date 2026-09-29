'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';
import { FinanceExceptionsQueue } from './finance-exceptions-queue';

/**
 * Vendor settlement and partner earning queues (ADM-48, ADM-49).
 *
 * Money owed to other people was the least visible thing in the console: the
 * settlement and payout endpoints existed but nothing listed them, so an
 * operator could not answer "who are we behind on paying?" without a database
 * query. Every figure here is integer paise from the ledger; nothing is
 * recomputed in the browser.
 */
type Row = Record<string, unknown>;

/**
 * The trial balance (10.1): the account catalogue with what has been posted
 * to it. The server refuses to render it unless the two totals agree, so
 * what appears here is either a balanced book or the refusal.
 */
type TrialBalance = {
  readonly accounts: readonly {
    readonly account_reference: string;
    readonly account_type: string;
    readonly owner_kind: string;
    readonly normal_side: 'CREDIT' | 'DEBIT';
    readonly lifecycle_state: string;
    readonly balance_minor: number;
    readonly entries: number;
  }[];
  readonly totals: { readonly debit_minor: number; readonly credit_minor: number };
};

/** The conservation report (10.7), as the finance screen reads it. */
export type Conservation = {
  readonly conserved: boolean;
  readonly checked: { readonly vendors: number; readonly partners: number };
  readonly breaches: readonly {
    readonly invariant: string;
    readonly subject: string;
    readonly ledger_minor: number | null;
    readonly expected_minor: number | null;
  }[];
};

export function conservationSentence(report: Conservation): string {
  if (report.conserved)
    return `The books agree with what ${report.checked.vendors} shops and ${report.checked.partners} partners are owed.`;
  const first = report.breaches[0];
  return `${report.breaches.length} disagreement(s) between the books and the records; first: ${first?.invariant.toLowerCase().replaceAll('_', ' ')} for ${first?.subject}.`;
}

function rupees(minor: unknown): string {
  const value = Number(minor ?? 0);
  return `₹${(Number.isFinite(value) ? value / 100 : 0).toFixed(2)}`;
}

function accountName(reference: string): string {
  return reference
    .replace(/^SYNTH-ACCOUNT-/, '')
    .replaceAll('-', ' ')
    .toLowerCase();
}

export function FinanceQueuesPanel() {
  const [payments, setPayments] = useState<Row[]>([]);
  const [refunds, setRefunds] = useState<Row[]>([]);
  const [ledger, setLedger] = useState<TrialBalance | null>(null);
  const [ledgerNotice, setLedgerNotice] = useState('Loading the trial balance…');
  const [conservation, setConservation] = useState('Checking the books against the records…');
  const [payoutId, setPayoutId] = useState('');
  const [message, setMessage] = useState('Loading the money queues…');

  const load = useCallback(async () => {
    try {
      const [paymentResult, refundResult] = await Promise.all([
        adminRequest<{ payments?: Row[] }>('admin/finance/payments'),
        adminRequest<{ refunds?: Row[] }>('admin/finance/refunds'),
      ]);
      setPayments(paymentResult.payments ?? []);
      setRefunds(refundResult.refunds ?? []);
      setMessage(
        `${paymentResult.payments?.length ?? 0} payments · ${refundResult.refunds?.length ?? 0} refunds.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The money queues failed to load.');
    }
    // Read apart from the queues: a book that does not balance is refused by
    // the server, and that refusal must be shown as itself, not as a failed
    // queue load.
    try {
      const balance = await adminRequest<TrialBalance>('admin/finance/v2/ledger');
      setLedger(balance);
      setLedgerNotice(
        `Debits ${rupees(balance.totals.debit_minor)} · credits ${rupees(balance.totals.credit_minor)} · balanced.`,
      );
    } catch (error) {
      setLedger(null);
      setLedgerNotice(
        error instanceof Error ? error.message : 'The trial balance could not be read.',
      );
    }
    // A balanced book can still disagree with what everyone is owed (10.7):
    // the conservation report reads the ledger against the records.
    try {
      const report = await adminRequest<Conservation>('admin/finance/v2/ledger/conservation');
      setConservation(conservationSentence(report));
    } catch (error) {
      setConservation(
        error instanceof Error ? error.message : 'The conservation report could not be read.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Submitting and reconciling a payout are separate acts. Submission hands the
   * instruction to the provider; reconciliation is what closes it against the
   * provider's own statement, and only then is the money considered settled.
   */
  async function payoutStep(step: 'submit' | 'reconcile') {
    if (!payoutId) {
      setMessage('Enter the payout identifier first.');
      return;
    }
    try {
      const result = await adminRequest<{ payout_state?: string }>(
        `admin/finance/payouts/${payoutId}/${step}`,
        {
          method: 'POST',
          body: JSON.stringify({
            command_reference: `PAYOUT-${step.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
            provider_scenario: 'SUCCESS',
            ...(step === 'reconcile'
              ? { provider_statement_reference: `SYNTH-STMT-${payoutId}` }
              : {}),
          }),
        },
      );
      setMessage(`Payout ${payoutId} is ${result.payout_state ?? step + 'ted'}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The payout ${step} failed.`);
    }
  }

  async function runDailyPayouts() {
    try {
      const result = await adminRequest<{ payout_batch_id?: string }>(
        'admin/finance/v2/payout-jobs/daily',
        {
          method: 'POST',
          body: JSON.stringify({
            command_reference: `PAYOUT-RUN-${Date.now().toString(36).toUpperCase()}`,
            provider_scenario: 'SUCCESS',
          }),
        },
      );
      setMessage(
        result.payout_batch_id
          ? `Daily payout batch ${result.payout_batch_id} created.`
          : 'Daily payout run completed.',
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The daily payout run failed.');
    }
  }

  return (
    <section className="catalogue-oversight" id="finance-queues">
      <div>
        <p className="eyebrow">MONEY QUEUES</p>
        <h2>Settlements, payouts and exceptions</h2>
        <p>Every amount is the ledger&apos;s own; nothing here recalculates money.</p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          Payout identifier
          <input value={payoutId} onChange={(e) => setPayoutId(e.target.value)} />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void payoutStep('submit')}>
            Submit payout
          </button>
          <button type="button" onClick={() => void payoutStep('reconcile')}>
            Reconcile payout
          </button>
          <button type="button" onClick={() => void runDailyPayouts()}>
            Run daily payouts
          </button>
          <button type="button" onClick={() => void load()}>
            Refresh queues
          </button>
        </div>
      </div>

      <div className="catalogue-flag" style={{ marginTop: '1rem' }}>
        <p className="eyebrow">TRIAL BALANCE</p>
        <p aria-live="polite">{ledgerNotice}</p>
        <p aria-live="polite">{conservation}</p>
        {ledger ? (
          <ul>
            {ledger.accounts.map((account) => (
              <li key={account.account_reference}>
                <strong>{accountName(account.account_reference)}</strong>{' '}
                {account.account_type.toLowerCase()} · {account.owner_kind.toLowerCase()} ·{' '}
                {account.normal_side.toLowerCase()} normal · {rupees(account.balance_minor)} across{' '}
                {account.entries} {account.entries === 1 ? 'entry' : 'entries'}
                {account.lifecycle_state === 'CLOSED' ? ' · closed' : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* 11.5: the exceptions are worked in their owned queues. */}
      <FinanceExceptionsQueue />

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {refunds.map((row, index) => (
          <article key={String(row['refund_id'] ?? `refund-${index}`)}>
            <span>REFUND · {String(row['refund_state'] ?? '')}</span>
            <strong>{rupees(row['refund_total_minor'])}</strong>
            <p>{String(row['source_order_reference'] ?? '')}</p>
          </article>
        ))}
        {payments.map((row, index) => (
          <article key={String(row['payment_transaction_id'] ?? `payment-${index}`)}>
            <span>PAYMENT · {String(row['payment_state'] ?? '')}</span>
            <strong>{rupees(row['amount_minor'])}</strong>
            <p>{String(row['source_checkout_reference'] ?? '')}</p>
          </article>
        ))}
        {refunds.length + payments.length === 0 && <p>No money movements recorded yet.</p>}
      </div>
    </section>
  );
}
